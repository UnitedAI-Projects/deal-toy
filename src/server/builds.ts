import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { boundedText, hash } from "./core";
import { fetchCad } from "./cad-runtime";
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
  name: z.enum(["model.step", "model.stl", "model.glb", "facts.json"]),
  mediaType: z.string(),
  base64: z.string().max(22_000_000),
});
const resultSchema = z.object({ artifacts: z.array(artifact).length(4) });
const media: Record<string, string> = {
  "model.step": "application/step",
  "model.stl": "model/stl",
  "model.glb": "model/gltf-binary",
  "facts.json": "application/json",
};
export async function consume(message: Message<unknown>, env: Env) {
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(message.body);
  const job = await env.DB.prepare(
    "SELECT jobs.*,revisions.source FROM jobs JOIN revisions ON revisions.id=jobs.revision_id WHERE jobs.id=?",
  )
    .bind(jobId)
    .first<{ status: string; source: string }>();
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
  const container = env.CAD.getByName(jobId);
  const keys: string[] = [];
  try {
    const response = await container.fetch(
      new Request("http://cad/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: job.source }),
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
    if (new Set(result.artifacts.map((a) => a.name)).size !== 4)
      throw new Error("Duplicate or missing exports");
    let total = 0;
    let facts = "{}";
    const statements: D1PreparedStatement[] = [];
    for (const artifact of result.artifacts) {
      const binary = Uint8Array.from(atob(artifact.base64), (c) =>
        c.charCodeAt(0),
      );
      total += binary.length;
      if (total > 15 * 1024 * 1024) throw new Error("Artifact limit exceeded");
      const objectKey = `builds/${jobId}/${artifact.name}`;
      keys.push(objectKey);
      if (artifact.name === "facts.json") {
        const data = z
          .object({
            units: z.literal("mm"),
            bounds: z.array(z.number().finite().nonnegative()).length(3),
            volume_mm3: z.number().finite().positive(),
            solids: z.number().int().positive(),
            valid: z.literal(true),
            manufacturing_approval: z.literal("not_reviewed"),
          })
          .parse(JSON.parse(new TextDecoder().decode(binary)));
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
    await env.DB.batch(statements);
    message.ack();
  } catch (error) {
    if (keys.length) await env.ARTIFACTS.delete(keys);
    const detail = error instanceof Error ? error.message : "Build failed";
    await env.DB.prepare(
      "UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?",
    )
      .bind(detail.slice(0, 4000), new Date().toISOString(), jobId)
      .run();
    message.ack();
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
