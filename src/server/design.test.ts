import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./core";
import { recordEvent } from "./activity";
import { execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-design@example.test", { level: "Maker" });
});

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
