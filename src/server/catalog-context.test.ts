import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "../../engine/tests/fixtures/deal_toy.py";
import { notchRecord } from "./actions/testdata/notch";
import type { Context } from "./core";
import { dispatch, execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-catalog@example.test", { level: "Maker" });
});

async function seeded() {
  const p = (await execute(carol, "projects_create", { name: "Catalog" })) as {
    id: string;
  };
  const m = (await execute(carol, "models_create", {
    projectId: p.id,
    name: "Lid",
  })) as { id: string };
  const r = (await execute(carol, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source: fixture,
  })) as {
    id: string;
  };
  return { p, m, r };
}
async function savedRow(
  key: string,
  projectId: string,
  revisionId: string,
  status: string,
  readyAt: string | null,
) {
  const [id, version] = key.split("@");
  await env.DB.prepare(
    "INSERT INTO saved_actions (id,version,scope,project_id,status,record,source,error,revision_id,job_id,created_by,created_at,ready_at) VALUES (?,?,'project',?,?,?,'# src',NULL,?,NULL,?,?,?)",
  )
    .bind(
      id,
      Number(version),
      projectId,
      status,
      JSON.stringify(notchRecord(key)),
      revisionId,
      "carol-catalog@example.test",
      "2026-01-01T00:00:00.000Z",
      readyAt,
    )
    .run();
}
const preset = (projectId: string, id: string) =>
  execute(carol, "presets_save", {
    projectId,
    id,
    expectedVersion: 0,
    action: "hole",
    name: "M3 clearance",
    description: "Clearance hole for M3.",
    inputs: { diameter: 3.4 },
  });
const mcp = (name: string, input: unknown) =>
  dispatch(carol, name, input, "mcp");

describe("the catalog the agent sees", () => {
  it("lists saved actions and presets", async () => {
    const { p, r } = await seeded();
    await savedRow(
      "cat-notch@1",
      p.id,
      r.id,
      "ready",
      "2026-01-01T00:00:00.000Z",
    );
    await preset(p.id, "cat-m3");
    const listed = (await execute(carol, "actions_list", {
      projectId: p.id,
    })) as {
      index: string;
      actions: { id: string; category: string }[];
    };
    expect(listed.actions.at(-1)).toMatchObject({
      id: "cat-notch@1",
      category: "Custom",
    });
    expect(listed.index).toContain("cat-notch@1: Cut a rounded finger notch");
    const described = (await execute(carol, "actions_describe", {
      id: "hole",
      projectId: p.id,
    })) as {
      presets: { id: string }[];
    };
    expect(described.presets.map((x) => x.id)).toContain("cat-m3");
    const saved = (await execute(carol, "actions_describe", {
      id: "cat-notch@1",
      projectId: p.id,
    })) as {
      creates: Record<string, string>;
    };
    expect(saved.creates).toEqual({ notch: "The curved notch face" });
    await expect(
      execute(carol, "actions_describe", { id: "cat-notch@1" }),
    ).rejects.toThrow("No saved action cat-notch@1");
    const { value } = await mcp("session_start", {
      projectId: p.id,
      prompt: "Notch the lid",
    });
    const actions = (value as { actions: string }).actions;
    expect(actions).toContain("cat-notch@1: ");
    expect(actions).toContain("Presets: M3 clearance (cat-m3, hole)");
  });
  it("tells a running session about new actions and presets once", async () => {
    const { p, m, r } = await seeded();
    const { value } = await mcp("session_start", {
      projectId: p.id,
      prompt: "Notch the lid",
    });
    const sessionId = (value as { sessionId: string }).sessionId;
    await savedRow(
      "new-notch@1",
      p.id,
      r.id,
      "ready",
      new Date(Date.now() + 1000).toISOString(),
    );
    await savedRow("new-notch@2", p.id, r.id, "rejected", null);
    const other = await seeded();
    await savedRow(
      "other-notch@1",
      other.p.id,
      other.r.id,
      "ready",
      new Date(Date.now() + 1000).toISOString(),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await preset(p.id, "new-m3");
    const first = await mcp("steps_list", { modelId: m.id, sessionId });
    expect(first.context).toContain(
      "New action new-notch@1: Cut a rounded finger notch",
    );
    expect(first.context).toContain(
      "New preset new-m3 (hole): Clearance hole for M3.",
    );
    expect(first.context).not.toContain("new-notch@2");
    expect(first.context).not.toContain("other-notch");
    const second = await mcp("steps_list", { modelId: m.id, sessionId });
    expect(second.context).not.toContain("New action");
  });
});
