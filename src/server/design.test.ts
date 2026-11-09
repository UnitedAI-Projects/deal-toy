import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "./core";
import { recordEvent } from "./activity";
import { openPlan } from "./design/plans";
import { dispatch, execute } from "./tools";
import { member } from "./test-helpers";
import bridge from "../../examples/bridge.py";
import modelingSkill from "../../skills/modeling/SKILL.md";
import { tools } from "./tools";

let carol: Context;
let dave: Context;
let viewer: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-design@example.test", { level: "Maker" });
  dave = await member("dave-design@example.test", { level: "Maker" });
  viewer = await member("viewer-design@example.test", { level: "Demo" });
});
// Builds are queued but never run here; clear them so the shared queue cap is not reached.
beforeEach(async () => {
  await env.DB.prepare(
    "UPDATE jobs SET status='failed' WHERE status IN ('queued','running')",
  ).run();
});

const agent = (name: string, input: unknown, c = carol) =>
  dispatch(c, name, input, "mcp").then((r) => r.value);
const region = (z0: number, z1: number) => ({
  min: [-45, -45, z0] as [number, number, number],
  max: [45, 45, z1] as [number, number, number],
});
const CUP = {
  request: "A tea cup with a gold rim",
  sections: [
    {
      name: "Overall size",
      value: "95 mm tall, 84 mm rim",
      source: "answered",
    },
    { name: "Rim", value: "round, rolled lip", source: "answered" },
    { name: "Designs", value: "none", source: "assumed" },
  ],
  framework: [
    {
      name: "Cup wall",
      kind: "shape",
      params: ["CUP_HEIGHT"],
      region: region(0, 95),
    },
    { name: "Rim", kind: "modify", params: [], region: region(90, 95) },
    { name: "Handle", kind: "shape", params: [], region: region(20, 80) },
  ],
};
type Sheet = {
  request: string;
  sections: { name: string; value: string; source: string }[];
  framework: { name: string }[];
  built: boolean;
};

async function newModel(c = carol, name = "Tea cup") {
  const p = (await execute(c, "projects_create", { name })) as { id: string };
  const m = (await execute(c, "models_create", {
    projectId: p.id,
    name,
  })) as { id: string };
  return { projectId: p.id, modelId: m.id };
}

const stamp = () => new Date().toISOString();
function insertPlan(
  projectId: string,
  modelId: string,
  status: "open" | "finished" | "stopped",
) {
  return env.DB.prepare(
    "INSERT INTO change_plans (id,model_id,project_id,session_id,member,by_kind,framework,request,layers,status,started_at,updated_at) VALUES (?,?,?,NULL,?,'agent',0,'test','{}',?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      modelId,
      projectId,
      carol.identity.email,
      status,
      stamp(),
      stamp(),
    )
    .run();
}

describe("design tables", () => {
  it("allows one open plan per model", async () => {
    const { projectId, modelId } = await newModel();
    await insertPlan(projectId, modelId, "open");
    await expect(insertPlan(projectId, modelId, "open")).rejects.toThrow(
      /UNIQUE/,
    );
    await insertPlan(projectId, modelId, "finished");
    const n = await env.DB.prepare(
      "SELECT count(*) AS n FROM change_plans WHERE model_id=?",
    )
      .bind(modelId)
      .first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it("records design and change events", async () => {
    const { projectId } = await newModel();
    const design = await recordEvent(carol, {
      projectId,
      kind: "design",
      payload: { request: "a tea cup" },
    });
    const change = await recordEvent(carol, {
      projectId,
      kind: "change",
      payload: { type: "begin" },
    });
    expect(design?.kind).toBe("design");
    expect(change?.kind).toBe("change");
  });

  it("keeps saving revisions, each with the change that made it", async () => {
    const { modelId } = await newModel();
    const saved = (await execute(carol, "models_save", {
      modelId,
      expectedRevision: 0,
      source: "PARAMS = {}\n",
    })) as { id: string; number: number };
    expect(saved.number).toBe(1);
    const row = await env.DB.prepare(
      "SELECT p.by_kind FROM revisions r JOIN change_plans p ON p.id=r.change_id WHERE r.id=?",
    )
      .bind(saved.id)
      .first<{ by_kind: string }>();
    expect(row!.by_kind).toBe("person");
  });
});

describe("design_start", () => {
  it("stores the sheet and opens the framework plan", async () => {
    const { projectId, modelId } = await newModel();
    const started = (await agent("design_start", { modelId, ...CUP })) as {
      sheet: Sheet;
      planId: string;
    };
    expect(started.planId).toBeTruthy();
    const { sheet } = (await agent("design_get", { modelId })) as {
      sheet: Sheet;
    };
    expect(sheet.request).toBe(CUP.request);
    expect(sheet.sections.map((x) => x.name)).toEqual([
      "Overall size",
      "Rim",
      "Designs",
    ]);
    expect(sheet.framework.map((l) => l.name)).toEqual([
      "Cup wall",
      "Rim",
      "Handle",
    ]);
    expect(sheet.built).toBe(false);
    const plans = await env.DB.prepare(
      "SELECT id,framework,status,by_kind,layers FROM change_plans WHERE model_id=?",
    )
      .bind(modelId)
      .all<{
        id: string;
        framework: number;
        status: string;
        by_kind: string;
        layers: string;
      }>();
    expect(plans.results).toHaveLength(1);
    expect(plans.results[0]).toMatchObject({
      id: started.planId,
      framework: 1,
      status: "open",
      by_kind: "agent",
    });
    expect(
      JSON.parse(plans.results[0].layers).add.map(
        (l: { name: string }) => l.name,
      ),
    ).toEqual(["Cup wall", "Rim", "Handle"]);
    const event = await env.DB.prepare(
      "SELECT payload FROM project_events WHERE project_id=? AND kind='design'",
    )
      .bind(projectId)
      .first<{ payload: string }>();
    expect(JSON.parse(event!.payload)).toMatchObject({
      modelId,
      assumed: ["Designs"],
      framework: ["Cup wall", "Rim", "Handle"],
    });
  });

  it("refuses an empty section value", async () => {
    const { modelId } = await newModel();
    const sections = [{ name: "Rim", value: " ", source: "answered" }];
    await expect(
      agent("design_start", { modelId, ...CUP, sections }),
    ).rejects.toThrow(/sections.*value/s);
  });

  it("refuses duplicate layer names", async () => {
    const { modelId } = await newModel();
    const framework = [
      CUP.framework[0],
      { ...CUP.framework[1], name: "Cup wall" },
    ];
    await expect(
      agent("design_start", { modelId, ...CUP, framework }),
    ).rejects.toThrow("Layer names must be unique: Cup wall");
  });

  it("refuses the reserved name Framework", async () => {
    const { modelId } = await newModel();
    const framework = [{ ...CUP.framework[0], name: "Framework" }];
    await expect(
      agent("design_start", { modelId, ...CUP, framework }),
    ).rejects.toThrow(
      "The layer name Framework is reserved for the model's PARAMS",
    );
  });

  it("refuses a region whose min is not below max", async () => {
    const { modelId } = await newModel();
    const framework = [{ ...CUP.framework[0], region: region(95, 95) }];
    await expect(
      agent("design_start", { modelId, ...CUP, framework }),
    ).rejects.toThrow(/framework.*region.*min must be below max/s);
  });

  it("refuses a second design sheet", async () => {
    const { modelId } = await newModel();
    await agent("design_start", { modelId, ...CUP });
    await expect(agent("design_start", { modelId, ...CUP })).rejects.toThrow(
      "This model already has a design sheet; change it through change_begin.",
    );
  });

  it("denies other members and demo viewers", async () => {
    const { projectId, modelId } = await newModel();
    await expect(
      agent("design_start", { modelId, ...CUP }, dave),
    ).rejects.toMatchObject({ status: 404 });
    await expect(agent("design_get", { modelId }, dave)).rejects.toMatchObject({
      status: 404,
    });
    await agent("design_start", { modelId, ...CUP });
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(projectId)
      .run();
    await expect(
      agent("design_start", { modelId, ...CUP }, viewer),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    const seen = (await agent("design_get", { modelId }, viewer)) as {
      sheet: Sheet;
    };
    expect(seen.sheet.request).toBe(CUP.request);
  });

  it("returns no sheet for a model without one", async () => {
    const { modelId } = await newModel();
    expect(await agent("design_get", { modelId })).toEqual({ sheet: null });
  });
});

/** A steps-layout source whose layers are the given names, each a trivial body step. */
function stepsSource(names: string[], params = "{}") {
  const steps = names
    .map(
      (n, k) =>
        `    m.body(${JSON.stringify(n)}, shape="box", size=(10, 10, ${k + 1}))\n`,
    )
    .join("");
  return (
    "import build123d as bd\nimport mantel as mt\n\n" +
    `PARAMS = ${params}\n\n\ndef base():\n    return None\n\n\n` +
    "def build():\n    m = mt.Model(base(), params=PARAMS)\n" +
    `    # mantel:steps begin\n${steps}    # mantel:steps end\n` +
    "    return m.result()\n"
  );
}
async function seedRevision(modelId: string, source: string) {
  const model = await env.DB.prepare("SELECT revision FROM models WHERE id=?")
    .bind(modelId)
    .first<{ revision: number }>();
  const n = model!.revision + 1;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO revisions (id,model_id,number,source,created_at) VALUES (?,?,?,?,?)",
    ).bind(crypto.randomUUID(), modelId, n, source, stamp()),
    env.DB.prepare("UPDATE models SET revision=? WHERE id=?").bind(n, modelId),
  ]);
  return n;
}
async function designed(c = carol) {
  const model = await newModel(c);
  const started = (await agent(
    "design_start",
    { modelId: model.modelId, ...CUP },
    c,
  )) as { planId: string };
  return { ...model, frameworkPlan: started.planId };
}
/** A model whose framework is built and finished, ready for change plans. */
async function built(c = carol) {
  const model = await designed(c);
  await seedRevision(model.modelId, stepsSource(["Cup wall", "Rim", "Handle"]));
  await agent(
    "change_finish",
    { planId: model.frameworkPlan, summary: "Framework built." },
    c,
  );
  return model;
}
async function planRow(planId: string) {
  return (await env.DB.prepare("SELECT * FROM change_plans WHERE id=?")
    .bind(planId)
    .first<{ status: string; current: string | null; phrases: string }>())!;
}
async function changeEvents(projectId: string) {
  const { results } = await env.DB.prepare(
    "SELECT payload FROM project_events WHERE project_id=? AND kind='change' ORDER BY rowid",
  )
    .bind(projectId)
    .all<{ payload: string }>();
  return results.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
}

describe("change plans", () => {
  it("opens, reports and finishes a plan", async () => {
    const { projectId, modelId } = await built();
    const { planId } = (await agent("change_begin", {
      modelId,
      request: "Make the handle thinner",
      edit: ["Handle"],
    })) as { planId: string };
    await agent("change_progress", {
      planId,
      layer: "Handle",
      phrases: ["Thinning the grip", "Keeping the joins"],
    });
    const progress = await planRow(planId);
    expect(progress.current).toBe("Handle");
    expect(JSON.parse(progress.phrases)).toEqual([
      "Thinning the grip",
      "Keeping the joins",
    ]);
    const finished = (await agent("change_finish", {
      planId,
      summary: "Handle is 2 mm thinner.",
    })) as { missing: string[] };
    expect(finished.missing).toEqual([]);
    expect((await planRow(planId)).status).toBe("finished");
    const types = (await changeEvents(projectId))
      .filter((e) => e.planId === planId)
      .map((e) => e.type);
    expect(types).toEqual(["begin", "progress", "finish"]);
  });

  it("refuses a plan without a design sheet", async () => {
    const { modelId } = await newModel();
    await expect(
      agent("change_begin", { modelId, request: "x", edit: ["Rim"] }),
    ).rejects.toThrow(
      "This model has no design sheet. Question the person about every section, then call design_start.",
    );
  });

  it("refuses an empty plan", async () => {
    const { modelId } = await built();
    await expect(
      agent("change_begin", { modelId, request: "x", follow: ["Rim"] }),
    ).rejects.toThrow(
      "A plan must add, edit, remove or rename at least one layer.",
    );
  });

  it("refuses a second open plan", async () => {
    const { modelId } = await built();
    await agent("change_begin", { modelId, request: "x", edit: ["Rim"] });
    await expect(
      agent("change_begin", { modelId, request: "y", edit: ["Handle"] }),
    ).rejects.toThrow(
      /^A change plan is already open for this model \(started .+ by carol-design@example\.test\)\. Finish it with change_finish\.$/,
    );
  });

  it("refuses progress on an undeclared layer", async () => {
    const { modelId } = await built();
    const { planId } = (await agent("change_begin", {
      modelId,
      request: "x",
      edit: ["Rim"],
      follow: ["Cup wall"],
    })) as { planId: string };
    await agent("change_progress", { planId, layer: "Cup wall" });
    await expect(
      agent("change_progress", { planId, layer: "Handle" }),
    ).rejects.toThrow("Handle is not in this plan.");
  });

  it("refuses another member's plan", async () => {
    const { modelId } = await built();
    const { planId } = (await agent("change_begin", {
      modelId,
      request: "x",
      edit: ["Rim"],
    })) as { planId: string };
    await expect(
      agent("change_progress", { planId, layer: "Rim" }, dave),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("stops a plan after 30 minutes without activity", async () => {
    const { modelId } = await built();
    const { planId } = (await agent("change_begin", {
      modelId,
      request: "x",
      edit: ["Rim"],
    })) as { planId: string };
    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    await env.DB.prepare("UPDATE change_plans SET updated_at=? WHERE id=?")
      .bind(old, planId)
      .run();
    expect(
      await openPlan({ ...carol, channel: "internal" }, modelId),
    ).toBeNull();
    expect((await planRow(planId)).status).toBe("stopped");
    await expect(
      agent("change_progress", { planId, layer: "Rim" }),
    ).rejects.toThrow(
      "This plan is stopped. It stopped after 30 minutes without activity.",
    );
    await expect(
      agent("change_begin", { modelId, request: "again", edit: ["Rim"] }),
    ).resolves.toMatchObject({ planId: expect.any(String) });
  });

  it("session_end stops the session's open plans", async () => {
    const { projectId, modelId } = await built();
    const { sessionId } = (await agent("session_start", {
      projectId,
      prompt: "Change the rim",
    })) as { sessionId: string };
    const { planId } = (await agent("change_begin", {
      sessionId,
      modelId,
      request: "Change the rim",
      edit: ["Rim"],
    })) as { planId: string };
    await agent("session_end", { sessionId, summary: "Stopped early." });
    expect((await planRow(planId)).status).toBe("stopped");
    const stopped = (await changeEvents(projectId)).find(
      (e) => e.planId === planId && e.type === "stopped",
    );
    expect(stopped).toMatchObject({ reason: "session_ended" });
  });

  it("framework plan cannot finish before its layers exist", async () => {
    const { modelId, frameworkPlan } = await designed();
    await seedRevision(modelId, stepsSource(["Cup wall"]));
    await expect(
      agent("change_finish", { planId: frameworkPlan, summary: "Done." }),
    ).rejects.toThrow("The framework is not built yet: missing Rim, Handle.");
    expect((await planRow(frameworkPlan)).status).toBe("open");
  });

  it("finishing the framework plan marks the sheet built", async () => {
    const { modelId } = await built();
    const { sheet } = (await agent("design_get", { modelId })) as {
      sheet: Sheet;
    };
    expect(sheet.built).toBe(true);
  });

  it("reports added layers that were never built", async () => {
    const { modelId } = await built();
    const { planId } = (await agent("change_begin", {
      modelId,
      request: "Add a saucer",
      add: [{ name: "Saucer", kind: "shape", region: region(-5, 0) }],
    })) as { planId: string };
    const finished = (await agent("change_finish", {
      planId,
      summary: "Gave up.",
    })) as { missing: string[] };
    expect(finished.missing).toEqual(["Saucer"]);
  });

  it("merges section updates by name", async () => {
    const { modelId } = await built();
    await agent("change_begin", {
      modelId,
      request: "Make the rim oval",
      edit: ["Rim"],
      sections: [{ name: "Rim", value: "oval 86 x 72", source: "answered" }],
    });
    const { sheet } = (await agent("design_get", { modelId })) as {
      sheet: Sheet;
    };
    expect(sheet.sections).toEqual([
      CUP.sections[0],
      { name: "Rim", value: "oval 86 x 72", source: "answered" },
      CUP.sections[2],
    ]);
  });
});

const person = (name: string, input: unknown, c = carol) =>
  dispatch(c, name, input, "http").then((r) => r.value);
const CUP_PARAMS =
  '{"CUP_HEIGHT": {"value": 95.0, "unit": "mm", "part": "Cup wall", "min": 50, "max": 150}}';
const box = (k: number) => ({ shape: "box", size: [10, 10, k] });
async function latest(modelId: string) {
  return (await env.DB.prepare(
    "SELECT r.id,r.number,r.source,r.change_id FROM revisions r JOIN models m ON m.id=r.model_id AND m.revision=r.number WHERE m.id=?",
  )
    .bind(modelId)
    .first<{
      id: string;
      number: number;
      source: string;
      change_id: string | null;
    }>())!;
}
/** A succeeded build of the latest revision, so parameter edits know the built PARAMS. */
async function seedFacts(modelId: string) {
  const r = await latest(modelId);
  const facts = {
    parts: [],
    steps: [],
    params: { CUP_HEIGHT: { value: 95, unit: "mm", min: 50, max: 150 } },
  };
  await env.DB.prepare(
    "INSERT INTO jobs (id,revision_id,status,error,facts,created_at,updated_at) VALUES (?,?,'succeeded',NULL,?,?,?)",
  )
    .bind(crypto.randomUUID(), r.id, JSON.stringify(facts), stamp(), stamp())
    .run();
}
/** The cup framework built by an agent through MCP: skeleton, then one layer at a time. */
async function agentBuilt(c = carol) {
  const model = await designed(c);
  await agent(
    "models_save",
    {
      modelId: model.modelId,
      expectedRevision: 0,
      source: stepsSource([], CUP_PARAMS),
    },
    c,
  );
  const names = CUP.framework.map((l) => l.name);
  for (const [k, name] of names.entries()) {
    await agent(
      "change_progress",
      { planId: model.frameworkPlan, layer: name },
      c,
    );
    await agent(
      "steps_add",
      {
        modelId: model.modelId,
        expectedRevision: k + 1,
        action: "body",
        name,
        inputs: box(k + 1),
      },
      c,
    );
  }
  await agent(
    "change_finish",
    { planId: model.frameworkPlan, summary: "Framework built." },
    c,
  );
  return { ...model, revision: names.length + 1 };
}
async function begin(modelId: string, layers: Record<string, unknown>) {
  return (
    (await agent("change_begin", { modelId, request: "test", ...layers })) as {
      planId: string;
    }
  ).planId;
}

describe("guard", () => {
  it("refuses agent geometry without a design sheet", async () => {
    const { modelId } = await newModel();
    await expect(
      agent("models_save", {
        modelId,
        expectedRevision: 0,
        source: stepsSource(["Cup wall"]),
      }),
    ).rejects.toThrow(
      "This model has no design sheet. Question the person about every section, then call design_start before saving geometry.",
    );
  });

  it("refuses agent writes with no open plan", async () => {
    const { modelId, revision } = await agentBuilt();
    await expect(
      agent("steps_edit", {
        modelId,
        expectedRevision: revision,
        name: "Rim",
        inputs: box(9),
      }),
    ).rejects.toThrow(
      "No change plan is open for this model. Call change_begin with the layers you will add, edit or remove.",
    );
  });

  it("says when the plan stopped for inactivity", async () => {
    const { modelId, revision } = await agentBuilt();
    const planId = await begin(modelId, { edit: ["Rim"] });
    await env.DB.prepare("UPDATE change_plans SET updated_at=? WHERE id=?")
      .bind(new Date(Date.now() - 31 * 60_000).toISOString(), planId)
      .run();
    await expect(
      agent("steps_edit", {
        modelId,
        expectedRevision: revision,
        name: "Rim",
        inputs: box(9),
      }),
    ).rejects.toThrow(
      "No change plan is open for this model. Call change_begin with the layers you will add, edit or remove. It stopped after 30 minutes without activity.",
    );
  });

  it("refuses free-form source for the framework", async () => {
    const { modelId } = await designed();
    await expect(
      agent("models_save", { modelId, expectedRevision: 0, source: bridge }),
    ).rejects.toThrow(
      "Use the steps layout: import mantel as mt, base() returning None, and one action per line between the mantel:steps markers.",
    );
  });

  it("refuses code in base()", async () => {
    const { modelId } = await designed();
    const source = stepsSource([]).replace(
      "return None",
      "return bd.Box(1, 1, 1)",
    );
    await expect(
      agent("models_save", { modelId, expectedRevision: 0, source }),
    ).rejects.toThrow("base() must return None; put geometry in layers.");
  });

  it("refuses layers outside the framework", async () => {
    const { modelId } = await designed();
    await expect(
      agent("models_save", {
        modelId,
        expectedRevision: 0,
        source: stepsSource(["Cup wall", "Saucer"]),
      }),
    ).rejects.toThrow(
      "Layers must come from the design sheet's framework, in order: Saucer is not in the framework.",
    );
    await expect(
      agent("models_save", {
        modelId,
        expectedRevision: 0,
        source: stepsSource(["Rim", "Cup wall"]),
      }),
    ).rejects.toThrow(
      "Layers must come from the design sheet's framework, in order: Cup wall must come before Rim.",
    );
  });

  it("builds the framework one layer at a time", async () => {
    const { modelId, frameworkPlan } = await agentBuilt();
    const { results } = await env.DB.prepare(
      "SELECT number,change_id FROM revisions WHERE model_id=? ORDER BY number",
    )
      .bind(modelId)
      .all<{ number: number; change_id: string }>();
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.change_id === frameworkPlan)).toBe(true);
  });

  it("refuses undeclared layer edits", async () => {
    const { modelId, revision } = await agentBuilt();
    await begin(modelId, { edit: ["Rim"] });
    await expect(
      agent("steps_edit", {
        modelId,
        expectedRevision: revision,
        name: "Handle",
        inputs: box(9),
      }),
    ).rejects.toThrow(
      "This write changes layers the plan does not declare: Handle. Start a new plan that includes them.",
    );
    const edited = (await agent("steps_edit", {
      modelId,
      expectedRevision: revision,
      name: "Rim",
      inputs: box(9),
    })) as { revision: { number: number } };
    expect(edited.revision.number).toBe(revision + 1);
  });

  it("refuses PARAMS changes without Framework", async () => {
    const { modelId, revision } = await agentBuilt();
    await seedFacts(modelId);
    await begin(modelId, { edit: ["Rim"] });
    await expect(
      agent("models_set_parameter", {
        modelId,
        expectedRevision: revision,
        name: "CUP_HEIGHT",
        value: 110,
      }),
    ).rejects.toThrow(
      "This write changes PARAMS; declare the Framework layer in the plan's edit list.",
    );
  });

  it("refuses undeclared shared code", async () => {
    const { modelId, revision } = await agentBuilt();
    await begin(modelId, { edit: ["Rim"] });
    const source = (await latest(modelId)).source.replace(
      "\n\ndef base():",
      "\n\ndef helper():\n    return 1\n\n\ndef base():",
    );
    await expect(
      agent("models_save", { modelId, expectedRevision: revision, source }),
    ).rejects.toThrow(
      "This write changes shared code (imports, helpers or module constants). Declare shared: true in the plan.",
    );
  });

  it("refuses base code on a built model", async () => {
    const { modelId, revision } = await agentBuilt();
    await begin(modelId, { edit: ["Rim"], shared: true });
    const source = (await latest(modelId)).source.replace(
      "return None",
      "return bd.Box(1, 1, 1)",
    );
    await expect(
      agent("models_save", { modelId, expectedRevision: revision, source }),
    ).rejects.toThrow("base() must return None; put geometry in layers.");
  });

  it("accepts declared renames and moves", async () => {
    const { modelId, revision } = await agentBuilt();
    const rename = await begin(modelId, {
      rename: [{ from: "Rim", to: "Lip" }],
    });
    await agent("steps_rename", {
      modelId,
      expectedRevision: revision,
      name: "Rim",
      newName: "Lip",
    });
    await agent("change_finish", { planId: rename, summary: "Renamed." });
    await begin(modelId, { edit: ["Handle"] });
    await agent("steps_move", {
      modelId,
      expectedRevision: revision + 1,
      name: "Handle",
      after: "Cup wall",
    });
    await expect(
      agent("steps_move", {
        modelId,
        expectedRevision: revision + 2,
        name: "Lip",
        after: null,
      }),
    ).rejects.toThrow(
      "This write changes layers the plan does not declare: Lip.",
    );
  });

  it("accepts agent writes without a sessionId from the plan's member", async () => {
    const { projectId, modelId, revision } = await agentBuilt();
    const { sessionId } = (await agent("session_start", {
      projectId,
      prompt: "Change the rim",
    })) as { sessionId: string };
    await agent("change_begin", {
      sessionId,
      modelId,
      request: "Change the rim",
      edit: ["Rim"],
    });
    await agent("steps_edit", {
      modelId,
      expectedRevision: revision,
      name: "Rim",
      inputs: box(9),
    });
    const { sessionId: other } = (await agent("session_start", {
      projectId,
      prompt: "Something else",
    })) as { sessionId: string };
    await expect(
      agent("steps_edit", {
        sessionId: other,
        modelId,
        expectedRevision: revision + 1,
        name: "Rim",
        inputs: box(8),
      }),
    ).rejects.toThrow(
      /^Another change plan is open for this model \(started .+ by carol-design@example\.test\)\.$/,
    );
  });

  it("records people's edits as person changes", async () => {
    const { modelId } = await newModel();
    await execute(carol, "models_save", {
      modelId,
      expectedRevision: 0,
      source: stepsSource(["Cup wall"], CUP_PARAMS),
    });
    await seedFacts(modelId);
    await person("models_set_parameter", {
      modelId,
      expectedRevision: 1,
      name: "CUP_HEIGHT",
      value: 110,
    });
    const r = await latest(modelId);
    expect(r.number).toBe(2);
    const plan = await env.DB.prepare("SELECT * FROM change_plans WHERE id=?")
      .bind(r.change_id)
      .first<{
        by_kind: string;
        status: string;
        layers: string;
        request: string;
      }>();
    expect(plan).toMatchObject({ by_kind: "person", status: "finished" });
    expect(JSON.parse(plan!.layers).edit).toContain("Framework");
    expect(plan!.request).toBe("Changed CUP_HEIGHT to 110");
  });

  it("a person's save during an agent plan is its own change", async () => {
    const { modelId, revision } = await agentBuilt();
    const planId = await begin(modelId, { edit: ["Rim"] });
    await person("steps_edit", {
      modelId,
      expectedRevision: revision,
      name: "Handle",
      inputs: box(7),
    });
    const r = await latest(modelId);
    expect(r.change_id).not.toBe(planId);
    expect((await planRow(r.change_id!)).status).toBe("finished");
    expect((await planRow(planId)).status).toBe("open");
    await expect(
      agent("steps_edit", {
        modelId,
        expectedRevision: revision,
        name: "Rim",
        inputs: box(9),
      }),
    ).rejects.toThrow("Model changed. Reload before saving.");
  });

  it("a refused or conflicting save leaves no person change", async () => {
    const { modelId } = await newModel();
    await execute(carol, "models_save", {
      modelId,
      expectedRevision: 0,
      source: stepsSource(["Cup wall"]),
    });
    const before = await env.DB.prepare(
      "SELECT count(*) AS n FROM change_plans WHERE model_id=?",
    )
      .bind(modelId)
      .first<{ n: number }>();
    await expect(
      person("models_save", {
        modelId,
        expectedRevision: 0,
        source: stepsSource(["Cup wall", "Rim"]),
      }),
    ).rejects.toThrow("Model changed. Reload before saving.");
    const after = await env.DB.prepare(
      "SELECT count(*) AS n FROM change_plans WHERE model_id=?",
    )
      .bind(modelId)
      .first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it("legacy free-form models still take people's parameter edits", async () => {
    const { modelId } = await newModel();
    await execute(carol, "models_save", {
      modelId,
      expectedRevision: 0,
      source: bridge,
    });
    const r = await latest(modelId);
    await env.DB.prepare(
      "INSERT INTO jobs (id,revision_id,status,error,facts,created_at,updated_at) VALUES (?,?,'succeeded',NULL,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        r.id,
        JSON.stringify({
          parts: [],
          params: { BASE_L: { value: 100, unit: "mm", min: 60, max: 200 } },
        }),
        stamp(),
        stamp(),
      )
      .run();
    await person("models_set_parameter", {
      modelId,
      expectedRevision: 1,
      name: "BASE_L",
      value: 120,
    });
    expect((await latest(modelId)).number).toBe(2);
    await expect(
      agent("models_save", { modelId, expectedRevision: 2, source: bridge }),
    ).rejects.toThrow("This model has no design sheet.");
  });
});

describe("modeling skill", () => {
  it("every tool the modeling skill names is registered", () => {
    const registered = new Set(tools.map((t) => t.name));
    const named = [...modelingSkill.matchAll(/`([a-z]+_[a-z_]+)`/g)]
      .map((m) => m[1])
      .filter((n) =>
        /^(models|steps|design|change|session|actions|presets|builds|projects|checks|inspect|documents|view|notes|selection)_/.test(
          n,
        ),
      );
    expect(named.filter((n) => !registered.has(n))).toEqual([]);
    for (const required of [
      "design_start",
      "change_begin",
      "change_progress",
      "change_finish",
    ])
      expect(named).toContain(required);
    // The design comes first: design_start is named before the first geometry tool.
    expect(modelingSkill.indexOf("`design_start`")).toBeLessThan(
      modelingSkill.indexOf("`steps_add`"),
    );
  });
});
