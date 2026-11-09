import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import bridge from "../../examples/bridge.py";
import boxJson from "../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import type { CheckResult } from "../shared/checks";
import type { Context } from "./core";
import { execute } from "./tools";
import { member } from "./test-helpers";
import { finish } from "./test-builds";

let carol: Context;
let viewer: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-measure@example.test", { level: "Maker" });
  viewer = await member("viewer-measure@example.test", { level: "Demo" });
});

async function built(record: unknown = boxJson) {
  const p = (await execute(carol, "projects_create", { name: "Measure" })) as {
    id: string;
  };
  const m = (await execute(carol, "models_create", {
    projectId: p.id,
    name: "Enclosure",
  })) as { id: string };
  const r = (await execute(carol, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source: bridge,
  })) as { id: string };
  const job = (await execute(carol, "models_build", { revisionId: r.id })) as {
    id: string;
  };
  await finish(job.id, record);
  return { p, m, r, job };
}

const queued = async (buildId: string) =>
  (
    await env.DB.prepare(
      "SELECT jobs.id,jobs.options FROM jobs WHERE purpose='measure' AND json_extract(options,'$.build')=?",
    )
      .bind(buildId)
      .all<{ id: string; options: string }>()
  ).results;

const lip = { a: { face: 7 }, b: { face: 47 } };
const answer = (requests: { key: string }[]) => ({
  results: requests.map((r) => ({
    key: r.key,
    distance: 0.3,
    points: [
      [38, 0, 28.5],
      [37.7, 0, 28.5],
    ],
  })),
});

describe("inspect_measure and measure jobs", () => {
  it("answers part pairs from the record without a job", async () => {
    const { job } = await built();
    const result = await execute(carol, "inspect_measure", {
      buildId: job.id,
      a: { part: 1 },
      b: { part: 2 },
    });
    expect(result).toEqual({
      status: "done",
      key: "p1-p2",
      distance: 15.391637,
      source: "record",
    });
    expect(await queued(job.id)).toEqual([]);
  });

  it("queues one measure job per pair and stores its result", async () => {
    const { job } = await built();
    const first = (await execute(carol, "inspect_measure", {
      buildId: job.id,
      ...lip,
    })) as { status: string; jobId: string; key: string };
    expect(first).toMatchObject({ status: "queued", key: "f47-f7" });
    const again = await execute(carol, "inspect_measure", {
      buildId: job.id,
      ...lip,
    });
    expect(again).toEqual(first);
    const jobs = await queued(job.id);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].options).requests).toEqual([
      { key: "f47-f7", ...lip },
    ]);
    const calls = await finish(first.jobId, null, { measure: answer });
    expect(calls[0].path).toBe("/measure");
    expect(calls[0].body.step).toBe(btoa("ISO-10303-21; bytes"));
    expect(calls[0].body).not.toHaveProperty("source");
    await expect(
      execute(carol, "inspect_measure", { buildId: job.id, ...lip }),
    ).resolves.toMatchObject({ status: "done", distance: 0.3 });
    const status = (await execute(carol, "builds_get", {
      jobId: first.jobId,
    })) as { status: string };
    expect(status.status).toBe("succeeded");
  });

  it("feeds measured values into check results", async () => {
    const { m, job } = await built();
    await execute(carol, "checks_save", {
      modelId: m.id,
      expectedVersion: 0,
      buildId: job.id,
      checks: [
        {
          name: "Lip gap",
          kind: "clearance",
          target: { faces: [{ index: 7 }, { index: 47 }] },
          limit: { min: 0.5 },
        },
      ],
    });
    const before = (await execute(carol, "checks_results", {
      modelId: m.id,
    })) as { results: CheckResult[] };
    expect(before.results[0]).toMatchObject({
      status: "unknown",
      reason: "Needs an exact measure",
    });
    const { jobId } = (await execute(carol, "inspect_measure", {
      buildId: job.id,
      ...lip,
    })) as { jobId: string };
    const running = (await execute(carol, "checks_results", {
      modelId: m.id,
    })) as { results: CheckResult[] };
    expect(running.results[0].reason).toBe("Measuring…");
    await finish(jobId, null, { measure: answer });
    const after = (await execute(carol, "checks_results", {
      modelId: m.id,
    })) as { results: CheckResult[] };
    expect(after.results[0]).toMatchObject({ status: "fail", value: 0.3 });
  });

  it("queues the measurements a new build's checks need, once", async () => {
    const { m, r, job } = await built();
    await execute(carol, "checks_save", {
      modelId: m.id,
      expectedVersion: 0,
      buildId: job.id,
      checks: [
        {
          name: "Lip gap",
          kind: "clearance",
          target: { faces: [{ index: 7 }, { index: 47 }] },
          limit: { min: 0.5 },
        },
      ],
    });
    const next = (await execute(carol, "models_build", {
      revisionId: r.id,
    })) as { id: string };
    await finish(next.id, boxJson);
    const jobs = await queued(next.id);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].options).requests).toEqual([
      { key: "f47-f7", ...lip },
    ]);
  });

  it("never queues for a build without an inspection record", async () => {
    const { r } = await built();
    const preview = (await execute(carol, "builds_view_as_of", {
      revisionId: r.id,
      step: "Deck",
    }).catch(() => null)) as { id: string } | null;
    const old = (await execute(carol, "models_build", {
      revisionId: r.id,
    })) as { id: string };
    await env.DB.prepare(
      "UPDATE jobs SET status='succeeded',facts='{}' WHERE id=?",
    )
      .bind(old.id)
      .run();
    for (const id of [old.id, preview?.id].filter(Boolean) as string[])
      await expect(
        execute(carol, "inspect_measure", { buildId: id, ...lip }),
      ).resolves.toEqual({
        status: "unknown",
        reason: "This build has no inspection record",
      });
    expect(await queued(old.id)).toEqual([]);
  });

  it("fails a measure job clearly when the build's STEP is gone", async () => {
    const { job } = await built();
    const { jobId } = (await execute(carol, "inspect_measure", {
      buildId: job.id,
      ...lip,
    })) as { jobId: string };
    await env.DB.prepare(
      "DELETE FROM artifacts WHERE job_id=? AND name='model.step'",
    )
      .bind(job.id)
      .run();
    await finish(jobId, null, { measure: answer });
    const status = (await execute(carol, "builds_get", { jobId })) as {
      status: string;
      error: string;
    };
    expect(status).toMatchObject({
      status: "failed",
      error: "The build's STEP is gone",
    });
    await expect(
      execute(carol, "inspect_measure", { buildId: job.id, ...lip }),
    ).resolves.toMatchObject({
      status: "failed",
      error: "The build's STEP is gone",
    });
  });

  it("refuses demo viewers anything that would queue, and counts toward the daily limit", async () => {
    const { p, job } = await built();
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
    await expect(
      execute(viewer, "inspect_measure", {
        buildId: job.id,
        a: { part: 1 },
        b: { part: 2 },
      }),
    ).resolves.toMatchObject({ status: "done" });
    await expect(
      execute(viewer, "inspect_measure", { buildId: job.id, ...lip }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await queued(job.id)).toEqual([]);
    const rows = await env.DB.prepare(
      "SELECT count(*) AS n FROM measurements WHERE build_id=?",
    )
      .bind(job.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
    const counted = await env.DB.prepare(
      "SELECT count(*) AS n FROM jobs WHERE created_by=?",
    )
      .bind("carol-measure@example.test")
      .first<{ n: number }>();
    await execute(carol, "inspect_measure", { buildId: job.id, ...lip });
    const after = await env.DB.prepare(
      "SELECT count(*) AS n FROM jobs WHERE created_by=?",
    )
      .bind("carol-measure@example.test")
      .first<{ n: number }>();
    expect(after!.n).toBe(counted!.n + 1);
  });

  it("keeps measure jobs out of the project's builds", async () => {
    const { p, job } = await built();
    const { jobId } = (await execute(carol, "inspect_measure", {
      buildId: job.id,
      ...lip,
    })) as { jobId: string };
    const project = (await execute(carol, "projects_get", {
      projectId: p.id,
    })) as { jobs: { id: string }[] };
    expect(project.jobs.map((j) => j.id)).toEqual([job.id]);
    expect(project.jobs.map((j) => j.id)).not.toContain(jobId);
  });

  it("rejects targets outside the build", async () => {
    const { job } = await built();
    await expect(
      execute(carol, "inspect_measure", {
        buildId: job.id,
        a: { face: 9999 },
        b: { part: 0 },
      }),
    ).rejects.toThrow("No face 9999 in this build");
  });
});
