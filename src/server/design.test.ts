import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./core";
import { recordEvent } from "./activity";
import { openPlan } from "./design/plans";
import { dispatch, execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
let dave: Context;
let viewer: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-design@example.test", { level: "Maker" });
  dave = await member("dave-design@example.test", { level: "Maker" });
  viewer = await member("viewer-design@example.test", { level: "Demo" });
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

  it("keeps saving revisions", async () => {
    const { modelId } = await newModel();
    const saved = (await execute(carol, "models_save", {
      modelId,
      expectedRevision: 0,
      source: "PARAMS = {}\n",
    })) as { id: string; number: number };
    expect(saved.number).toBe(1);
    const row = await env.DB.prepare(
      "SELECT change_id FROM revisions WHERE id=?",
    )
      .bind(saved.id)
      .first<{ change_id: string | null }>();
    expect(row!.change_id).toBeNull();
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
