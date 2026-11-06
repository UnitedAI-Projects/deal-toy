import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "../../engine/tests/fixtures/deal_toy.py";
import facts from "../../engine/tests/fixtures/deal_toy.facts.json";
import type { Context } from "./core";
import { dispatch, execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-purpose@example.test", { level: "Maker" });
});

/** A model with a succeeded revision build and a newer, different view job. */
async function seeded() {
  const p = (await execute(carol, "projects_create", { name: "Purpose" })) as {
    id: string;
  };
  const m = (await execute(carol, "models_create", {
    projectId: p.id,
    name: "Tombstone",
  })) as { id: string };
  const r = (await execute(carol, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source: fixture,
  })) as {
    id: string;
  };
  const insert = (id: string, purpose: string, data: unknown, at: string) =>
    env.DB.prepare(
      "INSERT INTO jobs (id,revision_id,status,error,facts,created_at,updated_at,purpose,options) VALUES (?,?,'succeeded',NULL,?,?,?,?,?)",
    )
      .bind(
        id,
        r.id,
        JSON.stringify(data),
        at,
        at,
        purpose,
        purpose === "view" ? '{"stopAfter":2}' : null,
      )
      .run();
  const build = crypto.randomUUID();
  const view = crypto.randomUUID();
  await insert(build, "build", facts, "2026-11-05T00:00:00.000Z");
  const viewFacts = {
    ...facts,
    params: { ONLY_IN_VIEW: { value: 1, unit: "mm" } },
    steps: facts.steps
      .slice(0, 2)
      .map((s) => ({ ...s, state: "warning", message: "view" })),
    stoppedAfter: 2,
  };
  await insert(view, "view", viewFacts, "2026-11-05T01:00:00.000Z");
  return { p, m, build, view };
}

describe("job purposes", () => {
  it("workspace lists only revision builds", async () => {
    const { p, build } = await seeded();
    const workspace = (await execute(carol, "projects_get", {
      projectId: p.id,
    })) as {
      jobs: { id: string }[];
    };
    expect(workspace.jobs.map((j) => j.id)).toEqual([build]);
  });
  it("step health and the summary ignore view jobs", async () => {
    const { m } = await seeded();
    const listed = (await execute(carol, "steps_list", { modelId: m.id })) as {
      health: { state: string }[];
    };
    expect(listed.health).toHaveLength(7);
    expect(listed.health.every((h) => h.state === "ok")).toBe(true);
    const { context } = await dispatch(
      carol,
      "steps_list",
      { modelId: m.id },
      "mcp",
    );
    expect(context).toContain("build ok.");
    expect(context).not.toContain("ONLY_IN_VIEW");
  });
  it("models_set_parameter reads build facts", async () => {
    const { m } = await seeded();
    await expect(
      execute(carol, "models_set_parameter", {
        modelId: m.id,
        expectedRevision: 1,
        name: "ONLY_IN_VIEW",
        value: 2,
      }),
    ).rejects.toThrow("no built parameter");
  });
});
