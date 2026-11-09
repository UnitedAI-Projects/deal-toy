import type { Target } from "../shared/checks";
import type { Context } from "./core";
import { queueBuild } from "./tool-kit";

export type MeasureRequest = { key: string; a: Target; b: Target };

/**
 * Queues one measure job for the requests a build has not measured yet: each (build, key) gets
 * one row, so a measurement is queued at most once per build. Returns the job measuring each key.
 */
export async function queueMeasures(
  c: Context,
  buildId: string,
  revisionId: string,
  requests: MeasureRequest[],
): Promise<Record<string, string | null>> {
  const fresh: MeasureRequest[] = [];
  for (const r of requests) {
    const inserted = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO measurements (build_id,key,value,job_id,status) VALUES (?,?,NULL,NULL,'queued')",
    )
      .bind(buildId, r.key)
      .run();
    if (inserted.meta.changes === 1) fresh.push(r);
  }
  if (fresh.length) {
    let job: { id: string };
    try {
      job = await queueBuild(c, revisionId, "measure", {
        build: buildId,
        requests: fresh,
      });
    } catch (error) {
      // Nothing was queued, so the measurements can be asked for again.
      await c.env.DB.batch(
        fresh.map((r) =>
          c.env.DB.prepare(
            "DELETE FROM measurements WHERE build_id=? AND key=? AND job_id IS NULL",
          ).bind(buildId, r.key),
        ),
      );
      throw error;
    }
    await c.env.DB.batch(
      fresh.map((r) =>
        c.env.DB.prepare(
          "UPDATE measurements SET job_id=? WHERE build_id=? AND key=?",
        ).bind(job.id, buildId, r.key),
      ),
    );
  }
  const out: Record<string, string | null> = {};
  for (const r of requests) {
    const row = await c.env.DB.prepare(
      "SELECT job_id FROM measurements WHERE build_id=? AND key=?",
    )
      .bind(buildId, r.key)
      .first<{ job_id: string | null }>();
    out[r.key] = row?.job_id ?? null;
  }
  return out;
}
