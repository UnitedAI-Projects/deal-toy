import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { boundedText, hash } from "./core";
import { fetchCad } from "./cad-runtime";
import { notify } from "./activity";
import { loadIdentity } from "./access";
import type { Check } from "../shared/checks";
import type { InspectRecord } from "../shared/inspect-types";
import { evaluateChecks } from "./checks/evaluate";
import { queueMeasures, type MeasureRequest } from "./measure";
import {
  checkSchema,
  checkVerdict,
  SAVED_KEY,
  sourcesFor,
} from "./actions/saved";
export class CadContainer extends DurableObject<Env> {
  async fetch(request: Request) {
    const container = this.ctx.container;
    if (!container) throw new Error("CAD container binding is missing");
    // Persistent backstop if a request or queue consumer disappears mid-build.
    await this.ctx.storage.setAlarm(Date.now() + 180_000);
    return fetchCad(container, request);
  }
  async destroy() {
    await this.ctx.container?.destroy();
    await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    await this.destroy();
  }
}
const artifact = z.object({
  name: z.enum([
    "model.step",
    "model.stl",
    "model.glb",
    "facts.json",
    "inspect.json",
    "blueprint.pdf",
    "blueprint.dxf",
  ]),
  mediaType: z.string(),
  base64: z.string().max(22_000_000),
});
const resultSchema = z.object({ artifacts: z.array(artifact).min(2).max(7) });
/** A view-as-of preview exports only the viewer mesh and facts. */
const PREVIEW = ["model.glb", "facts.json"];
/** Drawn after the exports when it fits the job's time; a build without them is still a good build. */
const DRAWINGS = ["blueprint.pdf", "blueprint.dxf"];
const target = z.union([
  z.object({ face: z.number().int().nonnegative() }).strict(),
  z.object({ part: z.number().int().nonnegative() }).strict(),
]);
const jobOptions = z
  .object({
    stopAfter: z.number().int().min(1).max(300).optional(),
    check: z.string().max(48).optional(),
    build: z.string().uuid().optional(),
    requests: z
      .array(
        z.object({ key: z.string().max(80), a: target, b: target }).strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();
const measureResult = z.object({
  results: z
    .array(
      z.object({
        key: z.string(),
        distance: z.number().finite().nonnegative().optional(),
        points: z.array(z.array(z.number().finite()).length(3)).optional(),
        error: z.string().max(300).optional(),
      }),
    )
    .max(50),
});

/** Base64 for binaries too large for one String.fromCharCode spread. */
function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
const paramSpec = z
  .object({
    value: z.number().finite(),
    unit: z.string().max(16).optional(),
    part: z.string().max(120).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict();
export const factsSchema = z.object({
  units: z.literal("mm"),
  bounds: z.array(z.number().finite().nonnegative()).length(3),
  volume_mm3: z.number().finite().positive(),
  solids: z.number().int().positive(),
  valid: z.literal(true),
  manufacturing_approval: z.literal("not_reviewed"),
  params: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), paramSpec)
    .optional(),
  parts: z
    .array(
      z.object({
        label: z.string().max(120),
        volume_mm3: z.number().finite().nonnegative(),
      }),
    )
    .max(500)
    .optional(),
  /** Present when the script uses mantel steps: each step's state, in order. */
  steps: z
    .array(
      z
        .object({
          name: z.string().max(80),
          action: z.string().regex(/^[a-z_]{1,40}$/),
          version: z.number().int().positive(),
          state: z.enum(["ok", "warning", "failed", "blocked", "suppressed"]),
          code: z
            .string()
            .regex(/^[a-z_]{1,40}$/)
            .optional(),
          message: z.string().max(300).optional(),
          created: z.array(z.string().max(80)).max(50),
          ms: z.number().int().nonnegative(),
        })
        .strict(),
    )
    .max(300)
    .optional(),
  incomplete: z.boolean().optional(),
  /** Set on view-as-of builds: only the first N steps ran. */
  stoppedAfter: z.number().int().positive().optional(),
  /** Set on saved-action check builds: the candidate's record and its example step. */
  check: checkSchema.optional(),
});
const media: Record<string, string> = {
  "model.step": "application/step",
  "model.stl": "model/stl",
  "model.glb": "model/gltf-binary",
  "facts.json": "application/json",
  "inspect.json": "application/json",
  "blueprint.pdf": "application/pdf",
  "blueprint.dxf": "image/vnd.dxf",
};
/** The exact-measurement record; items are checked by the reader, the outline here. */
export const inspectSchema = z
  .object({
    version: z.literal(1),
    units: z.literal("mm"),
    warnings: z.array(z.string().max(600)).max(500),
    parts: z.array(
      z.object({ index: z.number(), label: z.string() }).passthrough(),
    ),
    faces: z.array(
      z
        .object({ index: z.number(), part: z.number(), type: z.string() })
        .passthrough(),
    ),
    holes: z.array(z.object({ part: z.number() }).passthrough()),
    faces_truncated: z.boolean(),
  })
  .passthrough();
const INSPECT_LIMIT = 4 * 1024 * 1024;
export async function consume(message: Message<unknown>, env: Env) {
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(message.body);
  const job = await env.DB.prepare(
    "SELECT jobs.*,revisions.source,revisions.model_id,models.project_id FROM jobs JOIN revisions ON revisions.id=jobs.revision_id JOIN models ON models.id=revisions.model_id WHERE jobs.id=?",
  )
    .bind(jobId)
    .first<{
      status: string;
      revision_id: string;
      source: string;
      project_id: string;
      model_id: string;
      created_by: string | null;
      purpose: "build" | "check" | "view" | "measure";
      options: string | null;
    }>();
  if (!job || job.status === "succeeded" || job.status === "failed") {
    message.ack();
    return;
  }
  // Duplicate deliveries never start a second execution. The scheduled sweep marks
  // abandoned claims failed after fifteen minutes so an explicit rebuild is possible.
  if (job.status === "running") {
    message.ack();
    return;
  }
  const claim = await env.DB.prepare(
    "UPDATE jobs SET status='running',updated_at=? WHERE id=? AND status='queued'",
  )
    .bind(new Date().toISOString(), jobId)
    .run();
  if (claim.meta.changes !== 1) {
    message.ack();
    return;
  }
  await notify(env, job.project_id, { type: "workspace" });
  // Options are written by the Worker; anything unreadable runs as a plain build.
  let parsed: unknown = {};
  try {
    parsed = job.options ? JSON.parse(job.options) : {};
  } catch {
    parsed = {};
  }
  const options = jobOptions.safeParse(parsed).data ?? {};
  const preview = job.purpose === "view";
  const payload: Record<string, unknown> = { source: job.source };
  if (preview)
    Object.assign(payload, { stopAfter: options.stopAfter, preview });
  const expected: string[] = preview
    ? PREVIEW
    : Object.keys(media).filter((n) => !DRAWINGS.includes(n));
  if (job.purpose === "build") {
    const titled = await env.DB.prepare(
      "SELECT m.name AS title,r.number AS revision FROM revisions r JOIN models m ON m.id=r.model_id WHERE r.id=?",
    )
      .bind(job.revision_id)
      .first<{ title: string; revision: number }>();
    payload.drawing = titled ?? {};
  }
  const container = env.CAD.getByName(jobId);
  const keys: string[] = [];
  const checking =
    job.purpose === "check" ? SAVED_KEY.exec(options.check ?? "") : null;
  const settle = (
    status: "ready" | "rejected",
    value: string | null,
    error: string | null,
  ) =>
    env.DB.prepare(
      "UPDATE saved_actions SET status=?,record=COALESCE(?,record),error=?,job_id=?,ready_at=? WHERE id=? AND version=? AND status='checking'",
    ).bind(
      status,
      value,
      error,
      jobId,
      status === "ready" ? new Date().toISOString() : null,
      checking?.[1] ?? "",
      Number(checking?.[2] ?? 0),
    );
  try {
    if (job.purpose === "measure") {
      await measure(env, jobId, options, container);
      message.ack();
      await notify(env, job.project_id, { type: "workspace" });
      return;
    }
    // Saved actions the script pins travel with it; a check build also carries its candidate.
    const modules = await sourcesFor(env, job.project_id, job.source);
    if (checking) {
      const candidate = await env.DB.prepare(
        "SELECT source FROM saved_actions WHERE id=? AND version=?",
      )
        .bind(checking[1], Number(checking[2]))
        .first<{ source: string }>();
      if (!candidate)
        throw new Error("The saved action being checked no longer exists");
      modules[checking[0]] = candidate.source;
      payload.check = checking[0];
    }
    if (Object.keys(modules).length) payload.modules = modules;
    const response = await container.fetch(
      new Request("http://cad/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    const text = await boundedText(
      new Request("http://result", {
        method: "POST",
        body: response.body,
        duplex: "half",
      } as RequestInit),
      23_000_000,
    );
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      const detail = z.object({ error: z.string() }).safeParse(payload);
      throw new Error(
        detail.success ? detail.data.error : "CAD execution failed",
      );
    }
    const result = resultSchema.parse(JSON.parse(text));
    const names: string[] = result.artifacts.map((a) => a.name);
    if (
      new Set(names).size !== names.length ||
      !expected.every((n) => names.includes(n)) ||
      names.some(
        (n) =>
          !expected.includes(n) &&
          !(job.purpose === "build" && DRAWINGS.includes(n)),
      )
    )
      throw new Error("Duplicate or missing exports");
    let total = 0;
    let facts = "{}";
    let inspected: unknown = null;
    const statements: D1PreparedStatement[] = [];
    for (const artifact of result.artifacts) {
      const binary = Uint8Array.from(atob(artifact.base64), (c) =>
        c.charCodeAt(0),
      );
      total += binary.length;
      if (total > 15 * 1024 * 1024) throw new Error("Artifact limit exceeded");
      const objectKey = `builds/${jobId}/${artifact.name}`;
      keys.push(objectKey);
      if (artifact.name === "inspect.json") {
        if (binary.length > INSPECT_LIMIT)
          throw new Error("inspect.json exceeds its 4 MiB limit");
        inspected = JSON.parse(new TextDecoder().decode(binary));
        if (!inspectSchema.safeParse(inspected).success)
          throw new Error("inspect.json is not a valid inspection record");
      }
      if (artifact.name === "facts.json") {
        const data = factsSchema.parse(
          JSON.parse(new TextDecoder().decode(binary)),
        );
        facts = JSON.stringify(data);
      }
      await env.ARTIFACTS.put(objectKey, binary, {
        httpMetadata: { contentType: media[artifact.name] },
      });
      statements.push(
        env.DB.prepare("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)").bind(
          crypto.randomUUID(),
          jobId,
          artifact.name,
          objectKey,
          media[artifact.name],
          await hash(binary),
          binary.length,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        "UPDATE jobs SET status='succeeded',facts=?,updated_at=? WHERE id=? AND status='running'",
      ).bind(facts, new Date().toISOString(), jobId),
    );
    if (checking) {
      const verdict = checkVerdict(checking[0], JSON.parse(facts).check);
      statements.push(
        verdict.status === "ready"
          ? settle("ready", JSON.stringify(verdict.record), null)
          : settle("rejected", null, verdict.error),
      );
    }
    await env.DB.batch(statements);
    message.ack();
    await notify(env, job.project_id, { type: "workspace" });
    if (job.purpose === "build" && inspected && job.created_by)
      await measureForChecks(env, {
        buildId: jobId,
        revisionId: job.revision_id,
        modelId: job.model_id,
        member: job.created_by,
        record: inspected as InspectRecord,
      });
  } catch (error) {
    if (keys.length) await env.ARTIFACTS.delete(keys);
    const detail = error instanceof Error ? error.message : "Build failed";
    await env.DB.prepare(
      "UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?",
    )
      .bind(detail.slice(0, 4000), new Date().toISOString(), jobId)
      .run();
    if (job.purpose === "measure")
      await env.DB.prepare(
        "UPDATE measurements SET status='failed',value=? WHERE job_id=? AND status='queued'",
      )
        .bind(JSON.stringify({ error: detail.slice(0, 300) }), jobId)
        .run();
    if (checking)
      await settle(
        "rejected",
        null,
        `The check build failed: ${detail}`.slice(0, 600),
      ).run();
    message.ack();
    await notify(env, job.project_id, { type: "workspace" });
  } finally {
    try {
      await container.destroy();
    } catch {
      console.error(
        JSON.stringify({ event: "container_cleanup_failed", jobId }),
      );
    }
  }
}

/** A measure job: the build's STEP goes to the container, which runs no model code. */
async function measure(
  env: Env,
  jobId: string,
  options: z.infer<typeof jobOptions>,
  container: { fetch: (request: Request) => Promise<Response> },
) {
  if (!options.build || !options.requests?.length)
    throw new Error("A measure job needs a build and requests");
  const step = await env.DB.prepare(
    "SELECT object_key FROM artifacts WHERE job_id=? AND name='model.step'",
  )
    .bind(options.build)
    .first<{ object_key: string }>();
  const object = step ? await env.ARTIFACTS.get(step.object_key) : null;
  if (!object) throw new Error("The build's STEP is gone");
  const response = await container.fetch(
    new Request("http://cad/measure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: toBase64(new Uint8Array(await object.arrayBuffer())),
        requests: options.requests,
      }),
    }),
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = z.object({ error: z.string() }).safeParse(body);
    throw new Error(detail.success ? detail.data.error : "Measurement failed");
  }
  const { results } = measureResult.parse(body);
  const byKey = new Map(results.map((r) => [r.key, r]));
  await env.DB.batch([
    ...options.requests.map((r) => {
      const result = byKey.get(r.key);
      const done = result?.distance !== undefined;
      return env.DB.prepare(
        "UPDATE measurements SET status=?,value=? WHERE build_id=? AND key=? AND job_id=?",
      ).bind(
        done ? "done" : "failed",
        JSON.stringify(
          done
            ? { distance: result!.distance, points: result!.points }
            : { error: result?.error ?? "No result" },
        ),
        options.build,
        r.key,
        jobId,
      );
    }),
    env.DB.prepare(
      "UPDATE jobs SET status='succeeded',facts=?,updated_at=? WHERE id=? AND status='running'",
    ).bind(
      JSON.stringify({ measured: results.length }),
      new Date().toISOString(),
      jobId,
    ),
  ]);
}

/**
 * After a build, queues one measure job for the exact measurements its checks need. It runs as
 * the member who queued the build and counts toward their daily limit; a failure to queue never
 * fails the build.
 */
async function measureForChecks(
  env: Env,
  build: {
    buildId: string;
    revisionId: string;
    modelId: string;
    member: string;
    record: InspectRecord;
  },
) {
  try {
    const list = await env.DB.prepare(
      "SELECT checks FROM check_lists WHERE model_id=?",
    )
      .bind(build.modelId)
      .first<{ checks: string }>();
    if (!list) return;
    const needed = new Map<string, MeasureRequest>();
    for (const r of evaluateChecks(
      build.record,
      JSON.parse(list.checks) as Check[],
      {},
    ))
      if (r.measure) needed.set(r.measure.key, r.measure);
    if (!needed.size) return;
    const c = { env, identity: await loadIdentity(env, build.member) };
    await queueMeasures(c, build.buildId, build.revisionId, [
      ...needed.values(),
    ]);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "measure_queue_failed",
        buildId: build.buildId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}
