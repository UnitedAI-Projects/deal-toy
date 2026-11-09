import { z } from "zod";
import {
  CHECK_KINDS,
  type By,
  type Check,
  type CheckResult,
  type FaceTarget,
  type Measurement,
} from "../shared/checks";
import type { InspectRecord } from "../shared/inspect-types";
import { evaluateChecks, signatureOf } from "./checks/evaluate";
import { presetsFor } from "./checks/presets";
import { AppError, id, modelAccess, type Context } from "./core";
import { define, now, type Tool } from "./tool-kit";

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const label = z.string().trim().min(1).max(120);
const faceTarget = z
  .object({
    ref: z.record(z.string(), z.unknown()).optional(),
    signature: z
      .object({
        part: z.string().max(120),
        type: z.string().max(16),
        direction: vec3,
        center: vec3,
        area: finite.nonnegative(),
      })
      .strict(),
  })
  .strict();
/** A face given by its index in a build's record; the server turns it into a signature. */
const faceIndex = z.object({ index: z.number().int().nonnegative() }).strict();
const faceInput = z.union([faceTarget, faceIndex]);
type FaceInput = z.infer<typeof faceInput>;

const TARGETS: Record<Check["kind"], z.ZodType> = {
  stability: z.object({}).strict(),
  embed_wall: z.object({ part: label }).strict(),
  draft: z.object({ part: label }).strict(),
  dimension: z.object({ dimension: label }).strict(),
  clearance: z.union([
    z.object({ parts: z.tuple([label, label]) }).strict(),
    z.object({ faces: z.tuple([faceInput, faceInput]) }).strict(),
  ]),
  no_overlap: z.union([
    z.object({ parts: z.tuple([label, label]) }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ]),
  envelope: z.union([
    z.object({}).strict(),
    z.object({ part: label }).strict(),
  ]),
  hole: z.object({ face: faceInput }).strict(),
};
const limit = z
  .object({
    min: finite.nullable().optional(),
    max: finite.nullable().optional(),
    nominal: finite.nullable().optional(),
    tolerance: finite.nonnegative().nullable().optional(),
    size: vec3.nullable().optional(),
  })
  .strict();
/** Stamps a client sends are ignored: the server records who made each change. */
const checkInput = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .optional(),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(CHECK_KINDS),
  enabled: z.boolean().default(true),
  target: z.record(z.string(), z.unknown()),
  limit: limit.default({}),
  exceptions: z.array(faceInput).max(200).optional(),
});

type ListRow = { version: number; checks: string };
async function listOf(c: Context, modelId: string) {
  const row = await c.env.DB.prepare(
    "SELECT version,checks FROM check_lists WHERE model_id=?",
  )
    .bind(modelId)
    .first<ListRow>();
  return {
    version: row?.version ?? 0,
    checks: row ? (JSON.parse(row.checks) as Check[]) : [],
  };
}

/** A build's record, read after the caller's access to its model was checked. */
async function recordOf(
  env: Env,
  buildId: string,
): Promise<InspectRecord | null> {
  const row = await env.DB.prepare(
    "SELECT object_key FROM artifacts WHERE job_id=? AND name='inspect.json'",
  )
    .bind(buildId)
    .first<{ object_key: string }>();
  if (!row) return null;
  const object = await env.ARTIFACTS.get(row.object_key);
  return object ? ((await object.json()) as InspectRecord) : null;
}

/** The newest successful full build of a model's revision (by number), if any. */
async function buildOf(
  env: Env,
  modelId: string,
  number: number,
  before = false,
) {
  return env.DB.prepare(
    `SELECT jobs.id,revisions.number FROM jobs JOIN revisions ON revisions.id=jobs.revision_id
     WHERE revisions.model_id=? AND revisions.number ${before ? "<" : "="} ? AND jobs.purpose='build'
       AND jobs.status='succeeded'
       AND EXISTS(SELECT 1 FROM artifacts WHERE artifacts.job_id=jobs.id AND artifacts.name='inspect.json')
     ORDER BY revisions.number DESC, jobs.created_at DESC, jobs.rowid DESC LIMIT 1`,
  )
    .bind(modelId, number)
    .first<{ id: string; number: number }>();
}

async function measurementsOf(env: Env, buildId: string) {
  const rows = await env.DB.prepare(
    "SELECT key,value,status FROM measurements WHERE build_id=?",
  )
    .bind(buildId)
    .all<{
      key: string;
      value: string | null;
      status: Measurement["status"];
    }>();
  const out: Record<string, Measurement> = {};
  for (const r of rows.results) {
    const value = r.value
      ? (JSON.parse(r.value) as Record<string, unknown>)
      : {};
    out[r.key] = {
      status: r.status,
      ...(typeof value.distance === "number" ? { value: value.distance } : {}),
      ...(typeof value.error === "string" ? { error: value.error } : {}),
    };
  }
  return out;
}

export type Evaluation = {
  revision: number;
  buildId: string | null;
  checks: Check[];
  results: CheckResult[];
  record: InspectRecord | null;
};

/** Evaluates a model's checks against a revision's newest successful build. */
export async function evaluateModel(
  c: Context,
  modelId: string,
  revision?: number,
): Promise<Evaluation> {
  const model = await modelAccess(c, modelId, "read");
  const number = revision ?? model.revision;
  if (number < 1 || number > model.revision)
    throw new AppError(404, "Revision not found");
  const { checks } = await listOf(c, modelId);
  const build = await buildOf(c.env, modelId, number);
  const record = build ? await recordOf(c.env, build.id) : null;
  const results = record
    ? evaluateChecks(record, checks, await measurementsOf(c.env, build!.id))
    : checks.map((check) => ({
        id: check.id,
        status: "unknown" as const,
        reason: build
          ? "This build has no inspection record"
          : "This revision has no successful build",
      }));
  return {
    revision: number,
    buildId: build?.id ?? null,
    checks,
    results,
    record,
  };
}

const num = (v: number | undefined, unit?: string) =>
  v === undefined
    ? ""
    : `${v.toFixed(unit === "deg" ? 1 : 2)} ${unit ?? ""}`.trim();

/** One line for the agent's model summary: counts, failures first. */
export function checksLine(evaluation: Evaluation): string | null {
  const counted = evaluation.results.filter((r) => r.reason !== "Turned off");
  if (!counted.length) return null;
  const by = (s: CheckResult["status"]) =>
    counted.filter((r) => r.status === s);
  const names = new Map(evaluation.checks.map((c) => [c.id, c]));
  const fails = by("fail").map((r) => {
    const check = names.get(r.id);
    const min = check?.limit.min;
    const detail =
      r.value !== undefined && typeof min === "number"
        ? `${num(r.value, r.unit)} < ${num(min, r.unit)}`
        : (r.reason ?? num(r.value, r.unit));
    return `${check?.name ?? r.id} ${detail}`;
  });
  const parts = [
    `${by("pass").length} pass`,
    `${by("fail").length} fail${fails.length ? ` (${fails.join("; ")})` : ""}`,
  ];
  if (by("unknown").length) parts.push(`${by("unknown").length} unknown`);
  const line = `Checks: ${parts.join(" · ")}`;
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

const sameContent = (
  a: Check,
  b: Omit<Check, "created_by" | "created_at" | "edited_by" | "edited_at">,
) =>
  JSON.stringify([
    a.name,
    a.kind,
    a.enabled,
    a.target,
    a.limit,
    a.exceptions ?? null,
  ]) ===
  JSON.stringify([
    b.name,
    b.kind,
    b.enabled,
    b.target,
    b.limit,
    b.exceptions ?? null,
  ]);

export const checkTools: Tool[] = [
  define(
    "checks_list",
    "Read a model's saved checks (what is measured, the limit, enabled, who created and last edited each, and whether that was an agent) with the list version to pass to checks_save, plus presets: ready-made sets of ordinary checks for deal-toy processes, with limits left unset for the maker to confirm.",
    { modelId: id },
    true,
    async (c, i) => {
      const model = await modelAccess(c, i.modelId, "read");
      const list = await listOf(c, i.modelId);
      const build = await buildOf(c.env, i.modelId, model.revision);
      const record = build ? await recordOf(c.env, build.id) : null;
      return { ...list, presets: presetsFor(record) };
    },
  ),
  define(
    "checks_save",
    `Replace a model's check list. Pass expectedVersion from checks_list; a list changed since gives 409. Kinds and targets: stability {} (limit.min degrees of tilt before tipping); embed_wall {part} (limit.min mm of host around a declared embed); dimension {dimension: declared name} (limit.nominal ± limit.tolerance mm); clearance {parts: [a, b]} or {faces: [f, f]} (limit.min mm); no_overlap {parts: [a, b]} or {all: true}; envelope {} or {part} (limit.size [x, y, z] mm); hole {face} (limit.min/max diameter mm); draft {part} (limit.min degrees; exceptions lists faces). A face is {index} from inspect_get with buildId set, or a signature from an earlier list. Leave a limit null when the brief does not state it; never invent a supplier's minimum. Who made each change is recorded by the server.`,
    {
      modelId: id,
      expectedVersion: z.number().int().nonnegative(),
      checks: z.array(checkInput).max(100),
      buildId: id.optional(),
    },
    false,
    async (c, i) => {
      await modelAccess(c, i.modelId);
      const current = await listOf(c, i.modelId);
      if (current.version !== i.expectedVersion)
        throw new AppError(409, "Checks changed. Reload before saving.");
      let record: InspectRecord | null | undefined;
      const face = async (f: FaceInput): Promise<FaceTarget> => {
        if (!("index" in f)) return f;
        if (!i.buildId)
          throw new AppError(400, "Give buildId to name faces by index");
        record ??= await recordOf(c.env, i.buildId);
        const job = await c.env.DB.prepare(
          "SELECT 1 FROM jobs JOIN revisions ON revisions.id=jobs.revision_id WHERE jobs.id=? AND revisions.model_id=?",
        )
          .bind(i.buildId, i.modelId)
          .first();
        if (!record || !job)
          throw new AppError(
            400,
            "That build has no inspection record for this model",
          );
        try {
          return signatureOf(record, f.index);
        } catch {
          throw new AppError(400, `No face ${f.index} in that build`);
        }
      };
      const who: By = {
        email: c.identity.email,
        agent: c.channel === "mcp",
      };
      const stamp = now();
      const old = new Map(current.checks.map((k) => [k.id, k]));
      const ids = new Set<string>();
      const checks: Check[] = [];
      for (const input of i.checks) {
        const parsed = TARGETS[input.kind].safeParse(input.target);
        if (!parsed.success)
          throw new AppError(
            400,
            `Check "${input.name}": that target does not fit a ${input.kind} check`,
          );
        const target = { ...(parsed.data as Record<string, unknown>) };
        if (Array.isArray(target.faces))
          target.faces = [
            await face(target.faces[0] as FaceInput),
            await face(target.faces[1] as FaceInput),
          ];
        if (target.face) target.face = await face(target.face as FaceInput);
        const checkId =
          input.id ??
          `c-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
        if (ids.has(checkId))
          throw new AppError(400, `Two checks have the id "${checkId}"`);
        ids.add(checkId);
        const content = {
          id: checkId,
          name: input.name,
          kind: input.kind,
          enabled: input.enabled,
          target: target as Check["target"],
          limit: input.limit,
          ...(input.exceptions
            ? { exceptions: await Promise.all(input.exceptions.map(face)) }
            : {}),
        };
        const before = old.get(checkId);
        checks.push(
          before && sameContent(before, content)
            ? before
            : {
                ...content,
                created_by: before?.created_by ?? who,
                created_at: before?.created_at ?? stamp,
                edited_by: who,
                edited_at: stamp,
              },
        );
      }
      const write = current.version
        ? c.env.DB.prepare(
            "UPDATE check_lists SET version=version+1,checks=?,updated_at=? WHERE model_id=? AND version=?",
          ).bind(JSON.stringify(checks), stamp, i.modelId, current.version)
        : c.env.DB.prepare(
            "INSERT INTO check_lists VALUES (?,1,?,?) ON CONFLICT(model_id) DO NOTHING",
          ).bind(i.modelId, JSON.stringify(checks), stamp);
      if ((await write.run()).meta.changes !== 1)
        throw new AppError(409, "Checks changed. Reload before saving.");
      return { version: current.version + 1, checks };
    },
    "models.edit",
  ),
  define(
    "checks_results",
    "Evaluate a model's checks against a revision's newest successful build (the latest revision by default): pass, fail or unknown for each, with the measured value, the faces or parts involved, and why it is unknown. previous gives each check's result on the newest earlier revision with a build, to say what changed. A result with measure set needs inspect_measure.",
    { modelId: id, revision: z.number().int().positive().optional() },
    true,
    async (c, i) => {
      const now = await evaluateModel(c, i.modelId, i.revision);
      const previous: Record<
        string,
        { revision: number; status: string; value?: number }
      > = {};
      const earlier = await buildOf(c.env, i.modelId, now.revision, true);
      const record = earlier ? await recordOf(c.env, earlier.id) : null;
      if (earlier && record)
        for (const r of evaluateChecks(
          record,
          now.checks,
          await measurementsOf(c.env, earlier.id),
        ))
          previous[r.id] = {
            revision: earlier.number,
            status: r.status,
            ...(r.value !== undefined ? { value: r.value } : {}),
          };
      return {
        revision: now.revision,
        buildId: now.buildId,
        results: now.results,
        previous,
      };
    },
  ),
];
