import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "../../engine/tests/fixtures/deal_toy.py";
import facts from "../../engine/tests/fixtures/deal_toy.facts.json";
import bridge from "../../examples/bridge.py";
import { factsSchema } from "./builds";
import type { Context } from "./core";
import type { ProjectEvent } from "./activity";
import { readSteps, writeSteps } from "./actions/script";
import { dispatch, execute } from "./tools";
import { agentPlan, member } from "./test-helpers";

let carol: Context;
let viewer: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-steps@example.test", { level: "Maker" });
  viewer = await member("viewer-steps@example.test", { level: "Demo" });
});

async function seeded(source = fixture, c = carol) {
  const p = (await execute(c, "projects_create", { name: "Tombstone" })) as {
    id: string;
  };
  const m = (await execute(c, "models_create", {
    projectId: p.id,
    name: "Tombstone",
  })) as { id: string };
  const r = (await execute(c, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source,
  })) as { id: string };
  await env.DB.prepare(
    "INSERT INTO jobs (id,revision_id,status,error,facts,created_at,updated_at) VALUES (?,?,'succeeded',NULL,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      r.id,
      JSON.stringify(facts),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  return { p, m };
}
const call = (name: string, input: unknown, c = carol) =>
  dispatch(c, name, input, "http").then((r) => r.value);
async function sourceOf(modelId: string, number: number) {
  return (await env.DB.prepare(
    "SELECT source FROM revisions WHERE model_id=? AND number=?",
  )
    .bind(modelId, number)
    .first<{ source: string }>())!.source;
}
async function revisions(modelId: string) {
  return (await env.DB.prepare(
    "SELECT count(*) AS n FROM revisions WHERE model_id=?",
  )
    .bind(modelId)
    .first<{ n: number }>())!.n;
}
const hole = {
  on: { ref: "face", of: "Base", name: "bottom" },
  diameter: 4,
  extent: "through",
};

describe("action and step tools", () => {
  it("adds a hole and queues a build", async () => {
    const { p, m } = await seeded();
    const result = (await call("steps_add", {
      modelId: m.id,
      expectedRevision: 1,
      action: "hole",
      name: "Hole 3",
      inputs: hole,
    })) as { revision: { number: number }; job: { status: string } };
    expect(result.revision.number).toBe(2);
    expect(result.job.status).toBe("queued");
    const steps = readSteps(fixture).steps;
    expect(await sourceOf(m.id, 2)).toBe(
      writeSteps(fixture, [
        ...steps,
        { action: "hole", name: "Hole 3", inputs: hole, suppressed: false },
      ]),
    );
    const { events } = (await execute(carol, "projects_activity", {
      projectId: p.id,
    })) as { events: ProjectEvent[] };
    expect(events.map((e) => e.kind)).toEqual(["team_edit"]);
    expect(events[0].payload).toMatchObject({
      message: 'Added hole "Hole 3"',
      modelId: m.id,
      revision: 2,
      step: "Hole 3",
    });
  });
  it("refuses a stale revision", async () => {
    const { m } = await seeded();
    await expect(
      call("steps_add", {
        modelId: m.id,
        expectedRevision: 2,
        action: "hole",
        name: "Hole 3",
        inputs: hole,
      }),
    ).rejects.toThrow("Model changed");
  });
  it("refuses invalid inputs without saving", async () => {
    const { m } = await seeded();
    await expect(
      call("steps_add", {
        modelId: m.id,
        expectedRevision: 1,
        action: "hole",
        name: "Hole 3",
        inputs: { ...hole, diameter: 500 },
      }),
    ).rejects.toThrow("diameter must be at most 200 mm");
    await expect(
      call("steps_add", {
        modelId: m.id,
        expectedRevision: 1,
        action: "teleport",
        name: "X",
        inputs: {},
      }),
    ).rejects.toThrow("Unknown action teleport");
    await expect(
      call("steps_add", {
        modelId: m.id,
        expectedRevision: 1,
        action: "hole",
        name: "Coin",
        inputs: hole,
      }),
    ).rejects.toThrow('already named "Coin"');
    expect(await revisions(m.id)).toBe(1);
  });
  it("refuses a free-form script", async () => {
    const { m } = await seeded(bridge);
    await expect(
      call("steps_add", {
        modelId: m.id,
        expectedRevision: 1,
        action: "hole",
        name: "Hole 3",
        inputs: hole,
      }),
    ).rejects.toThrow("This model has no steps section");
  });
  it("lists steps with their health and describes actions", async () => {
    const { m } = await seeded();
    const listed = (await call("steps_list", { modelId: m.id })) as {
      revision: number;
      steps: { name: string; inputs?: unknown; raw?: unknown }[];
      health: { name: string; state: string }[];
    };
    expect(listed.revision).toBe(1);
    expect(listed.steps.map((s) => s.name)).toEqual(
      facts.steps.map((s) => s.name),
    );
    expect(listed.steps[0].raw).toBeUndefined();
    expect(listed.health.every((h) => h.state === "ok")).toBe(true);
    const catalog = (await call("actions_list", { category: "Modify" })) as {
      index: string;
      actions: { id: string }[];
      states: unknown[];
    };
    expect(catalog.actions.map((a) => a.id)).toEqual([
      "hole",
      "fillet",
      "chamfer",
      "shell",
    ]);
    expect(catalog.index.split("\n")).toHaveLength(14);
    expect(catalog.states).toHaveLength(6);
    const searched = (await call("actions_list", { query: "engrave" })) as {
      actions: { id: string }[];
    };
    expect(searched.actions.map((a) => a.id)).toEqual(["text"]);
    const described = (await call("actions_describe", { id: "hole" })) as {
      inputs: unknown;
      failures: unknown[];
    };
    expect(described.failures.length).toBeGreaterThan(3);
  });
  it("demo viewers can list but not add", async () => {
    const { p, m } = await seeded();
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
    const listed = (await call("steps_list", { modelId: m.id }, viewer)) as {
      steps: { name: string; inputs?: unknown }[];
    };
    expect(listed.steps.map((s) => s.name)).toContain("Mount hole");
    expect(listed.steps[0].inputs).toBeUndefined();
    await expect(call("actions_list", {}, viewer)).resolves.toBeTruthy();
    await expect(
      call(
        "steps_add",
        {
          modelId: m.id,
          expectedRevision: 1,
          action: "hole",
          name: "Hole 3",
          inputs: hole,
        },
        viewer,
      ),
    ).rejects.toThrow();
    expect(await revisions(m.id)).toBe(1);
  });
  it("suppress round trip", async () => {
    const { m } = await seeded();
    await call("steps_suppress", {
      modelId: m.id,
      expectedRevision: 1,
      name: "Deal text",
      suppressed: true,
    });
    expect(await sourceOf(m.id, 2)).toContain("depth=0.5, suppressed=True)\n");
    await call("steps_suppress", {
      modelId: m.id,
      expectedRevision: 2,
      name: "Deal text",
      suppressed: false,
    });
    expect(await sourceOf(m.id, 3)).toBe(fixture);
  });
  it("edits, moves, renames and removes", async () => {
    const { m } = await seeded();
    const base = { modelId: m.id };
    await call("steps_edit", {
      ...base,
      expectedRevision: 1,
      name: "Mount hole",
      inputs: { ...hole, at: [-30, 0, 0] },
    });
    await call("steps_move", {
      ...base,
      expectedRevision: 2,
      name: "Deal text",
      after: null,
    });
    await call("steps_rename", {
      ...base,
      expectedRevision: 3,
      name: "Block",
      newName: "Tower",
    });
    await call("steps_remove", {
      ...base,
      expectedRevision: 4,
      name: "Mid plane",
    });
    const steps = readSteps(await sourceOf(m.id, 5)).steps;
    expect(steps.map((s) => s.name)).toEqual([
      "Deal text",
      "Tower",
      "Mount hole",
      "Mount hole 2",
      "Coin cavity",
      "Block edges",
    ]);
    expect(steps[2].inputs.diameter).toBe(4);
    expect(steps[4].inputs.target).toEqual({ ref: "part", label: "Tower" });
    await expect(
      call("steps_edit", {
        ...base,
        expectedRevision: 5,
        name: "Mount hole",
        inputs: { ...hole, diameter: -1 },
      }),
    ).rejects.toThrow("diameter must be at least 0.2 mm");
  });
  it("describes removal truthfully", async () => {
    const { tools } = await import("./tools");
    const remove = tools.find((t) => t.name === "steps_remove")!;
    expect(remove.description).not.toContain("blocked");
    expect(remove.description).toContain("not found");
  });
  it("facts with steps validate", () => {
    expect(factsSchema.parse(facts).steps).toHaveLength(7);
    expect(() =>
      factsSchema.parse({
        ...facts,
        steps: [{ ...facts.steps[0], state: "pending" }],
      }),
    ).toThrow();
  });
});

describe("agent context", () => {
  it("MCP results carry the model context", async () => {
    const { m } = await seeded();
    await agentPlan(carol, m.id, {
      add: [{ name: "Hole 3", kind: "modify", region: null }],
    });
    const viaMcp = await dispatch(
      carol,
      "steps_list",
      { modelId: m.id },
      "mcp",
    );
    expect(viaMcp.context).toMatch(
      /^Model "Tombstone" r1, build ok\.\nSteps: 1 body "Block" ok/,
    );
    const viaHttp = await dispatch(
      carol,
      "steps_list",
      { modelId: m.id },
      "http",
    );
    expect(viaHttp.context).toBeUndefined();
    const added = await dispatch(
      carol,
      "steps_add",
      {
        modelId: m.id,
        expectedRevision: 1,
        action: "hole",
        name: "Hole 3",
        inputs: hole,
      },
      "mcp",
    );
    expect(added.context).toContain('Model "Tombstone" r2, build building.');
    expect(added.context).toContain('8 hole "Hole 3" pending');
  });
  it("session_start lists the actions", async () => {
    const { p } = await seeded();
    const { value } = await dispatch(
      carol,
      "session_start",
      { projectId: p.id, prompt: "Add a hole" },
      "mcp",
    );
    expect((value as { actions: string }).actions.split("\n")[3]).toMatch(
      /^hole@1: /,
    );
  });
});
