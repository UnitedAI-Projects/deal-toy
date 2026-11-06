import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "../../engine/tests/fixtures/deal_toy.py";
import { notchRecord } from "./actions/testdata/notch";
import { sourcesFor, visibleSaved } from "./actions/saved";
import { consume } from "./builds";
import type { Context } from "./core";
import { execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-saved@example.test", { level: "Maker" });
});

async function seeded(c = carol) {
  const p = (await execute(c, "projects_create", { name: "Saved" })) as {
    id: string;
  };
  const m = (await execute(c, "models_create", {
    projectId: p.id,
    name: "Lid",
  })) as { id: string };
  const r = (await execute(c, "models_save", {
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

const SOURCE = `import mantel as mt\n\n@mt.action(id="lid-notch", summary="Notch", inputs={}, example='m.custom("N", action="lid-notch@1")')\ndef lid_notch(m):\n    """Notch."""\n`;
const baseFacts = {
  units: "mm",
  bounds: [1, 2, 3],
  volume_mm3: 6,
  solids: 1,
  valid: true,
  manufacturing_approval: "not_reviewed",
};
/** Runs a queued job through consume with a fake CAD container; returns the posted payload. */
async function runJob(jobId: string, facts: unknown, ok = true) {
  const artifacts = [
    "model.step",
    "model.stl",
    "model.glb",
    "facts.json",
    "inspect.json",
  ].map((name) => ({
    name,
    mediaType: "ignored",
    base64: btoa(
      name === "facts.json"
        ? JSON.stringify(facts)
        : name === "inspect.json"
          ? '{"version":1,"units":"mm","warnings":[],"parts":[],"faces":[],"holes":[],"faces_truncated":false}'
          : "bytes",
    ),
  }));
  const container = {
    fetch: vi.fn(async (_request: Request) =>
      ok
        ? Response.json({ artifacts })
        : Response.json({ error: "Build failed: boom" }, { status: 400 }),
    ),
    destroy: vi.fn(async () => {}),
  };
  await consume(
    {
      body: { jobId },
      ack: vi.fn(),
      retry: vi.fn(),
    } as unknown as Message<unknown>,
    {
      DB: env.DB,
      ARTIFACTS: env.ARTIFACTS,
      CAD: { getByName: () => container },
    } as unknown as Env,
  );
  return JSON.parse(await container.fetch.mock.calls[0][0].text()) as Record<
    string,
    unknown
  >;
}
const save = (
  modelId: string,
  id: string,
  expectedVersion = 0,
  scope?: "project" | "team",
  c = carol,
) =>
  execute(c, "actions_save", {
    modelId,
    id,
    expectedVersion,
    source: SOURCE,
    ...(scope ? { scope } : {}),
  }) as Promise<{
    key: string;
    status: string;
    job: { id: string };
  }>;
const status = (key: string) =>
  execute(carol, "actions_status", { key }) as Promise<{
    status: string;
    error?: string;
    record?: { id: string };
  }>;
const passing = (key: string) => ({
  ...baseFacts,
  check: {
    key,
    record: notchRecord(key),
    step: {
      name: "Lid notch",
      action: "custom",
      version: 1,
      state: "ok",
      created: ["notch"],
      ms: 1,
    },
  },
});

describe("actions_save", () => {
  it("save queues a check build with the candidate", async () => {
    const { m } = await seeded();
    const saved = await save(m.id, "queued-notch");
    expect(saved).toMatchObject({ key: "queued-notch@1", status: "checking" });
    const body = await runJob(saved.job.id, passing("queued-notch@1"));
    expect(body.check).toBe("queued-notch@1");
    expect((body.modules as Record<string, string>)["queued-notch@1"]).toBe(
      SOURCE,
    );
    expect(body.source).toBe(fixture);
  });
  it("a passing check makes the action ready", async () => {
    const { m } = await seeded();
    const saved = await save(m.id, "ready-notch");
    await runJob(saved.job.id, passing("ready-notch@1"));
    const result = await status("ready-notch@1");
    expect(result.status).toBe("ready");
    expect(result.record?.id).toBe("ready-notch@1");
  });
  it("a failing or erroring check rejects it", async () => {
    const { m } = await seeded();
    const failed = await save(m.id, "bad-notch");
    const facts = passing("bad-notch@1");
    await runJob(failed.job.id, {
      ...facts,
      check: {
        ...facts.check,
        step: {
          ...facts.check.step,
          state: "failed",
          code: "face_not_found",
          message: "gone",
          created: [],
        },
      },
    });
    expect(await status("bad-notch@1")).toMatchObject({
      status: "rejected",
      error: expect.stringContaining("failed"),
    });
    const errored = await save(m.id, "bad-notch", 1);
    await runJob(errored.job.id, {
      ...baseFacts,
      check: {
        key: "bad-notch@2",
        error: "The summary must be 1 to 120 characters",
      },
    });
    expect(await status("bad-notch@2")).toMatchObject({
      status: "rejected",
      error: "The summary must be 1 to 120 characters",
    });
    const missing = await save(m.id, "bad-notch", 2);
    await runJob(missing.job.id, {
      ...facts,
      check: {
        ...facts.check,
        key: "bad-notch@3",
        record: notchRecord("bad-notch@3"),
        step: { ...facts.check.step, created: [] },
      },
    });
    expect(await status("bad-notch@3")).toMatchObject({
      status: "rejected",
      error: expect.stringContaining("notch"),
    });
  });
  it("a failed check build rejects it and leaves revision builds alone", async () => {
    const { p, m } = await seeded();
    const saved = await save(m.id, "boom-notch");
    await runJob(saved.job.id, null, false);
    expect(await status("boom-notch@1")).toMatchObject({
      status: "rejected",
      error: expect.stringContaining("boom"),
    });
    const workspace = (await execute(carol, "projects_get", {
      projectId: p.id,
    })) as { jobs: unknown[] };
    expect(workspace.jobs).toHaveLength(0);
  });
  it("concurrent saves conflict, and an id belongs to its first project", async () => {
    const { m } = await seeded();
    await save(m.id, "race-notch");
    await expect(save(m.id, "race-notch")).rejects.toThrow(
      "Action changed. Reload first",
    );
    const other = await seeded();
    await expect(save(other.m.id, "race-notch")).rejects.toThrow(
      "The id race-notch belongs to another project",
    );
    await expect(save(other.m.id, "race-notch", 1)).rejects.toThrow(
      "The id race-notch belongs to another project",
    );
    await expect(save(m.id, "race-notch", 1)).resolves.toMatchObject({
      key: "race-notch@2",
    });
  });
  it("keeps a version that is not ready private to its maker", async () => {
    const admin = await member("admin-saved@example.test", { level: "Admin" });
    const { m } = await seeded(admin);
    const shared = await save(m.id, "secret-notch", 0, "team", admin);
    await expect(status(shared.key)).rejects.toThrow(
      "No saved action secret-notch@1",
    );
    await expect(
      execute(admin, "actions_status", { key: shared.key }),
    ).resolves.toMatchObject({ status: "checking" });
  });
  it("team scope needs settings.manage", async () => {
    const { m } = await seeded();
    await expect(save(m.id, "team-only", 0, "team")).rejects.toThrow(
      "Configure skills and tools",
    );
  });
  it("refuses built-in ids and bad ids", async () => {
    const { m } = await seeded();
    await expect(save(m.id, "hole")).rejects.toThrow("built-in");
    await expect(save(m.id, "Bad Id")).rejects.toThrow();
  });
  it("builds send pinned sources only for visible actions", async () => {
    const { p, m, r } = await seeded();
    await saveRow("pinned-notch@1", {
      scope: "project",
      projectId: p.id,
      revisionId: r.id,
    });
    const source = fixture.replace(
      "    # mantel:steps end",
      '    m.custom("A", action="pinned-notch@1")\n    # mantel:steps end',
    );
    const next = (await execute(carol, "models_save", {
      modelId: m.id,
      expectedRevision: 1,
      source,
    })) as { id: string };
    const job = (await execute(carol, "models_build", {
      revisionId: next.id,
    })) as { id: string };
    const body = await runJob(job.id, baseFacts);
    expect(body.modules).toEqual({
      "pinned-notch@1": "# source of pinned-notch@1",
    });
    expect(body.check).toBeUndefined();
  });
});

describe("activity summaries", () => {
  it("records saves in plain words", async () => {
    const { p, m } = await seeded();
    const { dispatch } = await import("./tools");
    await dispatch(
      carol,
      "actions_save",
      {
        modelId: m.id,
        id: "summary-notch",
        expectedVersion: 0,
        source: SOURCE,
      },
      "http",
    );
    await dispatch(
      carol,
      "presets_save",
      {
        projectId: p.id,
        id: "summary-preset",
        expectedVersion: 0,
        action: "hole",
        name: "M3",
        description: "M3 clearance.",
        inputs: { diameter: 3.4 },
      },
      "http",
    );
    const { events } = (await execute(carol, "projects_activity", {
      projectId: p.id,
    })) as {
      events: { payload: { summary?: string } }[];
    };
    const summaries = events.map((e) => e.payload.summary).filter(Boolean);
    expect(summaries).toEqual([
      "Saved action summary-notch@1 for checking",
      "Saved preset summary-preset v1",
    ]);
  });
});
