import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import bridge from "../../examples/bridge.py";
import toyJson from "../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import boxJson from "../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import type { Check, CheckResult } from "../shared/checks";
import type { Context } from "./core";
import { dispatch, execute } from "./tools";
import { member } from "./test-helpers";
import { finish } from "./test-builds";

let carol: Context;
let dave: Context;
let viewer: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-checks@example.test", { level: "Maker" });
  dave = await member("dave-checks@example.test", { level: "Maker" });
  viewer = await member("viewer-checks@example.test", { level: "Demo" });
});

async function model(record: unknown = toyJson) {
  const p = (await execute(carol, "projects_create", { name: "Checks" })) as {
    id: string;
  };
  const m = (await execute(carol, "models_create", {
    projectId: p.id,
    name: "Toy",
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
  return { p, m, job };
}

const embedWall = (min: number | null) => ({
  name: "Coin wall",
  kind: "embed_wall",
  target: { part: "Coin" },
  limit: { min },
});
type Listed = {
  version: number;
  checks: Check[];
  presets: { id: string; checks: unknown[] }[];
};
type Results = {
  revision: number;
  buildId: string | null;
  results: CheckResult[];
  previous?: Record<
    string,
    { revision: number; status: string; value?: number }
  >;
};

describe("check lists", () => {
  it("saves and lists checks, stamping who made them through which channel", async () => {
    const { m } = await model();
    const saved = (
      await dispatch(
        carol,
        "checks_save",
        {
          modelId: m.id,
          expectedVersion: 0,
          checks: [
            {
              ...embedWall(1),
              created_by: { email: "forged@example.test", agent: true },
            },
          ],
        },
        "http",
      )
    ).value as Listed;
    expect(saved.version).toBe(1);
    const [check] = saved.checks;
    expect(check.created_by).toEqual({
      email: "carol-checks@example.test",
      agent: false,
    });
    expect(check.id).toMatch(/^c-[0-9a-f]{8}$/);
    const listed = (await execute(carol, "checks_list", {
      modelId: m.id,
    })) as Listed;
    expect(listed.checks).toEqual(saved.checks);
    expect(listed.presets.map((p) => p.id)).toContain("acrylic-embedment");
    // The agent changes the limit: creation stays the person's, the edit is the agent's.
    const edited = (
      await dispatch(
        carol,
        "checks_save",
        {
          modelId: m.id,
          expectedVersion: 1,
          checks: [{ ...check, limit: { min: 2 } }],
        },
        "mcp",
      )
    ).value as Listed;
    expect(edited.checks[0].created_by.agent).toBe(false);
    expect(edited.checks[0].edited_by).toEqual({
      email: "carol-checks@example.test",
      agent: true,
    });
  });

  it("refuses a save made against an older list", async () => {
    const { m } = await model();
    await execute(carol, "checks_save", {
      modelId: m.id,
      expectedVersion: 0,
      checks: [embedWall(1)],
    });
    await expect(
      execute(carol, "checks_save", {
        modelId: m.id,
        expectedVersion: 0,
        checks: [embedWall(3)],
      }),
    ).rejects.toMatchObject({ status: 409 });
    const listed = (await execute(carol, "checks_list", {
      modelId: m.id,
    })) as Listed;
    expect(listed.checks[0].limit).toEqual({ min: 1 });
  });

  it("rejects targets that do not fit the kind", async () => {
    const { m } = await model();
    await expect(
      execute(carol, "checks_save", {
        modelId: m.id,
        expectedVersion: 0,
        checks: [{ ...embedWall(1), target: { parts: ["A", "B"] } }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("turns face indices into signatures from a build", async () => {
    const { m, job } = await model(boxJson);
    const saved = (await execute(carol, "checks_save", {
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
    })) as Listed;
    const target = saved.checks[0].target as {
      faces: { signature: { part: string; center: number[] } }[];
    };
    expect(target.faces[0].signature).toMatchObject({
      part: "Housing",
      center: [38, 0, 16],
    });
    await expect(
      execute(carol, "checks_save", {
        modelId: m.id,
        expectedVersion: 1,
        checks: [
          {
            name: "Lip gap",
            kind: "clearance",
            target: { faces: [{ index: 7 }, { index: 47 }] },
            limit: { min: 0.5 },
          },
        ],
      }),
    ).rejects.toThrow("buildId");
  });

  it("evaluates the latest build and compares with the previous revision", async () => {
    const { m } = await model();
    await execute(carol, "checks_save", {
      modelId: m.id,
      expectedVersion: 0,
      checks: [embedWall(1), embedWall(null)],
    });
    const r2 = (await execute(carol, "models_save", {
      modelId: m.id,
      expectedRevision: 1,
      source: bridge,
    })) as { id: string };
    const job = (await execute(carol, "models_build", {
      revisionId: r2.id,
    })) as {
      id: string;
    };
    await finish(job.id, {
      ...toyJson,
      embeds: [{ part: 2, in: 1, contained: true, wall: 0.8 }],
    });
    const results = (await execute(carol, "checks_results", {
      modelId: m.id,
    })) as Results;
    expect(results.revision).toBe(2);
    expect(results.buildId).toBe(job.id);
    const [wall, tbd] = results.results;
    expect(wall).toMatchObject({ status: "fail", value: 0.8 });
    expect(tbd.reason).toBe("Limit not set (TBD: confirm with your maker)");
    expect(results.previous?.[wall.id]).toEqual({
      revision: 1,
      status: "pass",
      value: 1.5,
    });
    const older = (await execute(carol, "checks_results", {
      modelId: m.id,
      revision: 1,
    })) as Results;
    expect(older.results[0].status).toBe("pass");
    expect(older.previous).toEqual({});
  });

  it("names failures in the agent's model summary", async () => {
    const { m } = await model();
    await execute(carol, "checks_save", {
      modelId: m.id,
      expectedVersion: 0,
      checks: [
        embedWall(2),
        {
          name: "Stands up",
          kind: "stability",
          target: {},
          limit: { min: 10 },
        },
        { name: "Tall", kind: "stability", target: {}, limit: { min: 20 } },
      ],
    });
    const { context } = await dispatch(
      carol,
      "checks_list",
      { modelId: m.id },
      "mcp",
    );
    expect(context).toContain(
      "Checks: 1 pass · 2 fail (Coin wall 1.50 mm < 2.00 mm; Tall 17.1° < 20.0°)",
    );
  });

  it("lets demo viewers read checks but not change them, and hides private models", async () => {
    const { p, m } = await model();
    await execute(carol, "checks_save", {
      modelId: m.id,
      expectedVersion: 0,
      checks: [embedWall(1)],
    });
    await expect(
      execute(dave, "checks_list", { modelId: m.id }),
    ).rejects.toMatchObject({ status: 404 });
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
    await expect(
      execute(viewer, "checks_list", { modelId: m.id }),
    ).resolves.toMatchObject({ version: 1 });
    await expect(
      execute(viewer, "checks_results", { modelId: m.id }),
    ).resolves.toMatchObject({ results: [{ status: "pass" }] });
    await expect(
      execute(viewer, "checks_save", {
        modelId: m.id,
        expectedVersion: 1,
        checks: [],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      execute(dave, "checks_save", {
        modelId: m.id,
        expectedVersion: 1,
        checks: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
    const listed = (await execute(carol, "checks_list", {
      modelId: m.id,
    })) as Listed;
    expect(listed.checks).toHaveLength(1);
  });
});
