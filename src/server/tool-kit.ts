import { z } from "zod";
import type { Permission } from "./access";
import {
  AppError,
  id,
  modelAccess,
  revisionAccess,
  type Context,
} from "./core";
/** Building blocks shared by every tool module: definitions, revisions and build queueing. */
export type Tool = {
  name: string;
  description: string;
  schema: z.ZodObject;
  readOnly: boolean;
  /** Every listed permission is required. */
  permission?: Permission[];
  run: (context: Context, input: unknown) => Promise<unknown>;
};
export function define<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  readOnly: boolean,
  run: (
    c: Context,
    input: z.infer<z.ZodObject<S>> & { sessionId?: string },
  ) => Promise<unknown>,
  permission?: Permission | Permission[],
): Tool {
  // Every tool accepts an optional sessionId so the call attaches to an agent session.
  const schema = z.object({ sessionId: id.optional(), ...shape }).strict();
  return {
    name,
    description,
    schema,
    readOnly,
    permission:
      permission === undefined
        ? undefined
        : Array.isArray(permission)
          ? permission
          : [permission],
    run: (c, input) =>
      run(
        c,
        schema.parse(input) as z.infer<z.ZodObject<S>> & { sessionId?: string },
      ),
  };
}
export const now = () => new Date().toISOString();
export async function saveRevision(
  c: Context,
  modelId: string,
  expectedRevision: number,
  source: string,
) {
  await modelAccess(c, modelId);
  const revisionId = crypto.randomUUID();
  const rows = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO revisions SELECT ?,id,revision+1,?,? FROM models WHERE id=? AND revision=?",
    ).bind(revisionId, source, now(), modelId, expectedRevision),
    c.env.DB.prepare(
      "UPDATE models SET revision=revision+1 WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)",
    ).bind(modelId, expectedRevision, revisionId),
  ]);
  if (rows[0].meta.changes !== 1)
    throw new AppError(409, "Model changed. Reload before saving.");
  return { id: revisionId, number: expectedRevision + 1 };
}
export type JobPurpose = "build" | "check" | "view";
/** Queues a job on a revision. Every purpose counts toward the member's daily build cap. */
export async function queueBuild(
  c: Context,
  revisionId: string,
  purpose: JobPurpose = "build",
  options?: Record<string, unknown>,
) {
  await revisionAccess(c, revisionId);
  const limit = Number.parseInt(c.env.DAILY_BUILD_LIMIT, 10) || 100;
  const today = await c.env.DB.prepare(
    "SELECT count(*) AS n FROM jobs WHERE created_by=? AND created_at>?",
  )
    .bind(c.identity.email, new Date(Date.now() - 86400_000).toISOString())
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= limit)
    throw new AppError(429, "Daily build limit reached");
  const jobId = crypto.randomUUID();
  const admitted = await c.env.DB.prepare(
    "INSERT INTO jobs (id,revision_id,status,error,facts,created_at,updated_at,created_by,purpose,options) SELECT ?,?,'queued',NULL,NULL,?,?,?,?,? WHERE (SELECT count(*) FROM jobs WHERE status IN ('queued','running'))<10",
  )
    .bind(
      jobId,
      revisionId,
      now(),
      now(),
      c.identity.email,
      purpose,
      options ? JSON.stringify(options) : null,
    )
    .run();
  if (admitted.meta.changes !== 1)
    throw new AppError(429, "Build queue is full; try later");
  try {
    await c.env.BUILDS.send({ jobId });
  } catch {
    await c.env.DB.prepare(
      "UPDATE jobs SET status='failed',error='Queue unavailable',updated_at=? WHERE id=?",
    )
      .bind(now(), jobId)
      .run();
    throw new AppError(503, "Build queue unavailable");
  }
  return { id: jobId, status: "queued" };
}
