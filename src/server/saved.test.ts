import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "../../engine/tests/fixtures/deal_toy.py";
import { notchRecord } from "./actions/testdata/notch";
import { sourcesFor, visibleSaved } from "./actions/saved";
import type { Context } from "./core";
import { execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-saved@example.test", { level: "Maker" });
});

async function seeded() {
  const p = (await execute(carol, "projects_create", { name: "Saved" })) as {
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
async function saveRow(
  key: string,
  options: {
    scope: "project" | "team";
    projectId: string | null;
    revisionId: string;
    status?: string;
  },
) {
  const [id, version] = key.split("@");
  await env.DB.prepare(
    "INSERT INTO saved_actions (id,version,scope,project_id,status,record,source,error,revision_id,job_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,NULL,?,NULL,?,?)",
  )
    .bind(
      id,
      Number(version),
      options.scope,
      options.projectId,
      options.status ?? "ready",
      JSON.stringify(notchRecord(key)),
      `# source of ${key}`,
      options.revisionId,
      "carol-saved@example.test",
      new Date().toISOString(),
    )
    .run();
}
const notchStep = (key: string) => ({
  modelId: "",
  expectedRevision: 1,
  action: "custom",
  name: "Notch",
  inputs: {
    action: key,
    on: { ref: "face", of: "Base", name: "front" },
    width: 18,
  },
});

describe("saved action visibility", () => {
  it("uses a project's own saved action in a step", async () => {
    const { p, m, r } = await seeded();
    await saveRow("lid-notch@1", {
      scope: "project",
      projectId: p.id,
      revisionId: r.id,
    });
    const result = (await execute(carol, "steps_add", {
      ...notchStep("lid-notch@1"),
      modelId: m.id,
    })) as {
      revision: { number: number };
    };
    expect(result.revision.number).toBe(2);
  });
  it("hides another project's saved action", async () => {
    const mine = await seeded();
    const theirs = await seeded();
    await saveRow("their-notch@1", {
      scope: "project",
      projectId: theirs.p.id,
      revisionId: theirs.r.id,
    });
    await expect(
      execute(carol, "steps_add", {
        ...notchStep("their-notch@1"),
        modelId: mine.m.id,
      }),
    ).rejects.toThrow("No saved action their-notch@1");
    expect(
      (await visibleSaved(carol, mine.p.id)).map((s) => s.key),
    ).not.toContain("their-notch@1");
  });
  it("shares team actions and hides ones still checking", async () => {
    const { p, r } = await seeded();
    await saveRow("team-notch@1", {
      scope: "team",
      projectId: null,
      revisionId: r.id,
    });
    await saveRow("team-notch@2", {
      scope: "team",
      projectId: null,
      revisionId: r.id,
      status: "checking",
    });
    const visible = await visibleSaved(carol, p.id);
    expect(
      visible.filter((s) => s.id === "team-notch").map((s) => s.key),
    ).toEqual(["team-notch@1"]);
  });
  it("sends pinned sources only for visible, ready actions", async () => {
    const mine = await seeded();
    const theirs = await seeded();
    await saveRow("pin-notch@1", {
      scope: "project",
      projectId: mine.p.id,
      revisionId: mine.r.id,
    });
    await saveRow("pin-notch@2", {
      scope: "project",
      projectId: mine.p.id,
      revisionId: mine.r.id,
      status: "rejected",
    });
    await saveRow("pin-other@1", {
      scope: "project",
      projectId: theirs.p.id,
      revisionId: theirs.r.id,
    });
    const source = fixture.replace(
      "    # mantel:steps end",
      '    m.custom("A", action="pin-notch@1")\n    m.custom("B", action="pin-notch@2")\n    m.custom("C", action="pin-other@1")\n    # mantel:steps end',
    );
    expect(await sourcesFor(env, mine.p.id, source)).toEqual({
      "pin-notch@1": "# source of pin-notch@1",
    });
    expect(
      await sourcesFor(env, mine.p.id, "def build():\n    return 1\n"),
    ).toEqual({});
  });
});
