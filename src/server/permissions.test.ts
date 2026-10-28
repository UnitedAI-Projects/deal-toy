import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./core";
import { dispatch, execute } from "./tools";
import { cookieFor, member } from "./test-helpers";

const origin = "https://example.test";
const source =
  "import build123d as bd\n\ndef build():\n    return bd.Box(10, 10, 10)\n";
let owner: Context;
let demo: { project: string; model: string; revision: string; job: string };
let artifacts: { glb: string; step: string };

/** A project with one revision and a finished build (artifacts written directly). */
async function project(c: Context, name: string) {
  const p = (await execute(c, "projects_create", { name, brief: "" })) as {
    id: string;
  };
  const m = (await execute(c, "models_create", {
    projectId: p.id,
    name: "Box",
  })) as { id: string };
  const r = (await execute(c, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source,
  })) as { id: string };
  return { project: p.id, model: m.id, revision: r.id };
}
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  owner = await member("owner@p.test", { owner: true, level: "Admin" });
  const p = await project(owner, "Demo bridge");
  const job = crypto.randomUUID();
  artifacts = { glb: crypto.randomUUID(), step: crypto.randomUUID() };
  await env.DB.batch([
    env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?").bind(p.project),
    env.DB.prepare(
      "INSERT INTO jobs (id,revision_id,status,facts,created_at,updated_at) VALUES (?,?,'succeeded','{}',?,?)",
    ).bind(job, p.revision, new Date().toISOString(), new Date().toISOString()),
    env.DB.prepare("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)").bind(
      artifacts.glb,
      job,
      "model.glb",
      `test/${artifacts.glb}`,
      "model/gltf-binary",
      "0",
      3,
    ),
    env.DB.prepare("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)").bind(
      artifacts.step,
      job,
      "model.step",
      `test/${artifacts.step}`,
      "model/step",
      "0",
      3,
    ),
  ]);
  await env.ARTIFACTS.put(`test/${artifacts.glb}`, "glb");
  await env.ARTIFACTS.put(`test/${artifacts.step}`, "stp");
  demo = { ...p, job };
});

const status = (pending: Promise<unknown>) =>
  pending.then(
    () => 200,
    (e: { status?: number }) => e.status ?? 500,
  );

describe("Permissions per tool", () => {
  it("deny each tool without its permission and allow it with the permission", async () => {
    const viewer = await member("demo-only@p.test", { level: "Demo" });
    const maker = await member("maker@p.test", { level: "Maker" });
    const admin = await member("admin@p.test", { level: "Admin" });
    const own = await project(maker, "Maker project");
    const cases: [string, Record<string, unknown>, Context][] = [
      ["projects_create", { name: "New", brief: "" }, maker],
      ["models_create", { projectId: own.project, name: "Second" }, maker],
      [
        "models_save",
        { modelId: own.model, expectedRevision: 1, source },
        maker,
      ],
      [
        "documents_add",
        { projectId: own.project, kind: "bom", title: "BOM", content: "-" },
        maker,
      ],
      ["models_build", { revisionId: own.revision }, maker],
      [
        "models_set_parameter",
        { modelId: own.model, expectedRevision: 2, name: "W", value: 1 },
        maker,
      ],
      ["notes_add", { projectId: own.project, message: "Hi" }, maker],
      [
        "skills_save",
        {
          skillId: "house-style",
          expectedVersion: 0,
          title: "House",
          description: "d",
          content: "c",
        },
        admin,
      ],
      ["tools_configure", { name: "projects_list", enabled: true }, admin],
    ];
    for (const [tool, input, allowed] of cases) {
      expect(await status(execute(viewer, tool, input)), tool).toBe(403);
      expect(await status(execute(allowed, tool, input)), tool).not.toBe(403);
    }
    expect(
      await status(
        execute(maker, "tools_configure", {
          name: "projects_list",
          enabled: true,
        }),
      ),
    ).toBe(403);
  });
});

describe("Demo projects", () => {
  it("can be read by a demo viewer", async () => {
    const viewer = await member("viewer@p.test", { level: "Demo" });
    expect(await execute(viewer, "projects_list", {})).toMatchObject({
      own: [],
      demo: [{ id: demo.project, demo: 1 }],
    });
    expect(
      await execute(viewer, "projects_get", { projectId: demo.project }),
    ).toMatchObject({ project: { id: demo.project } });
    expect(
      await execute(viewer, "projects_activity", { projectId: demo.project }),
    ).toHaveProperty("events");
    expect(
      await execute(viewer, "builds_get", { jobId: demo.job }),
    ).toMatchObject({ id: demo.job });
    const cookie = await cookieFor("viewer@p.test");
    const glb = await exports.default.fetch(
      `${origin}/api/artifacts/${artifacts.glb}`,
      { headers: { Cookie: cookie } },
    );
    expect(glb.status).toBe(200);
    const ticket = await exports.default.fetch(
      `${origin}/api/projects/${demo.project}/live-ticket`,
      { method: "POST", headers: { Cookie: cookie, Origin: origin } },
    );
    expect(ticket.status).toBe(200);
    const step = await exports.default.fetch(
      `${origin}/api/artifacts/${artifacts.step}`,
      { headers: { Cookie: cookie } },
    );
    expect(step.status).toBe(403);
  });
  it("cannot be written by a viewer through any tool", async () => {
    // A Maker holds every write permission, but does not own the demo.
    const viewer = await member("writer@p.test", { level: "Maker" });
    const writes: [string, Record<string, unknown>][] = [
      ["models_create", { projectId: demo.project, name: "X" }],
      ["models_save", { modelId: demo.model, expectedRevision: 1, source }],
      ["models_build", { revisionId: demo.revision }],
      [
        "models_set_parameter",
        { modelId: demo.model, expectedRevision: 1, name: "W", value: 1 },
      ],
      ["notes_add", { projectId: demo.project, message: "hi" }],
      [
        "documents_add",
        { projectId: demo.project, kind: "bom", title: "B", content: "-" },
      ],
      ["session_start", { projectId: demo.project, prompt: "change it" }],
    ];
    for (const [tool, input] of writes)
      expect(await status(execute(viewer, tool, input)), tool).toBe(404);
    // Reading the demo over MCP neither records activity nor takes the owner's notes.
    await execute(owner, "notes_add", {
      projectId: demo.project,
      message: "For the next agent",
    });
    const read = await dispatch(
      viewer,
      "projects_get",
      { projectId: demo.project },
      "mcp",
    );
    expect(read.notes).toEqual([]);
    const recorded = await env.DB.prepare(
      "SELECT count(*) AS n FROM project_events WHERE actor='writer@p.test'",
    ).first<{ n: number }>();
    expect(recorded?.n).toBe(0);
    const delivered = await env.DB.prepare(
      "SELECT count(*) AS n FROM note_deliveries",
    ).first<{ n: number }>();
    expect(delivered?.n).toBe(0);
  });
  it("never record source in tool-call arguments", async () => {
    await dispatch(
      owner,
      "models_save",
      { modelId: demo.model, expectedRevision: 1, source: `${source}# v2\n` },
      "mcp",
    );
    const saved = await env.DB.prepare(
      "SELECT payload FROM project_events WHERE project_id=? AND kind='tool_call' AND payload LIKE '%models_save%' ORDER BY rowid DESC",
    )
      .bind(demo.project)
      .first<{ payload: string }>();
    const args = JSON.parse(saved!.payload).args as Record<string, unknown>;
    expect(args).toMatchObject({ modelId: demo.model, expectedRevision: 1 });
    expect(args).not.toHaveProperty("source");
  });
  it("show source only to viewers who may download exports", async () => {
    // An event recorded before source was left out of tool-call arguments.
    await env.DB.prepare(
      "INSERT INTO project_events VALUES (?,?,NULL,'tool_call',?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        demo.project,
        "owner@p.test",
        JSON.stringify({ tool: "models_save", ok: true, args: { source } }),
        new Date().toISOString(),
      )
      .run();
    const read = async (c: Context) => {
      const project = (await execute(c, "projects_get", {
        projectId: demo.project,
      })) as { revisions: { source?: string }[] };
      const activity = (await execute(c, "projects_activity", {
        projectId: demo.project,
      })) as { events: { payload: { args?: { source?: string } } }[] };
      return {
        revisions: project.revisions.map((r) => r.source),
        args: activity.events
          .map((e) => e.payload.args?.source)
          .filter(Boolean),
      };
    };
    const viewer = await read(await member("look@p.test", { level: "Demo" }));
    expect(viewer.revisions.every((s) => s === undefined)).toBe(true);
    expect(viewer.args).toEqual([]);
    const allowed = await read(
      await member("fetch@p.test", {
        level: "Demo",
        allow: ["exports.download"],
      }),
    );
    // Revisions are where permitted viewers read source; activity never carries it for them.
    expect(allowed.revisions).toContain(source);
    expect(allowed.args).toEqual([]);
  });
  it("never show the owner's or team's emails to viewers", async () => {
    const started = (await execute(owner, "session_start", {
      projectId: demo.project,
      prompt: "Make the demo",
    })) as { sessionId: string };
    await execute(owner, "notes_add", {
      projectId: demo.project,
      message: "Team note",
    });
    const viewer = await member("private@p.test", { level: "Demo" });
    const seen = JSON.stringify([
      await execute(viewer, "projects_list", {}),
      await execute(viewer, "projects_get", { projectId: demo.project }),
      await execute(viewer, "projects_activity", { projectId: demo.project }),
    ]);
    expect(seen).not.toContain("owner@p.test");
    expect(seen).toContain(started.sessionId);
    const own = JSON.stringify(
      await execute(owner, "projects_activity", { projectId: demo.project }),
    );
    expect(own).toContain("owner@p.test");
    // The live feed a viewer follows carries the same redaction.
    const cookie = await cookieFor("private@p.test");
    const { ticket } = (await (
      await exports.default.fetch(
        `${origin}/api/projects/${demo.project}/live-ticket`,
        { method: "POST", headers: { Cookie: cookie, Origin: origin } },
      )
    ).json()) as { ticket: string };
    const socket = (
      await exports.default.fetch(
        `${origin}/api/projects/${demo.project}/live?ticket=${ticket}`,
        { headers: { Upgrade: "websocket" } },
      )
    ).webSocket!;
    socket.accept();
    const received = new Promise<string>((resolve) =>
      socket.addEventListener("message", (m) => resolve(String(m.data))),
    );
    await execute(owner, "notes_add", {
      projectId: demo.project,
      message: "Live note",
    });
    const live = await received;
    expect(live).toContain("Live note");
    expect(live).not.toContain("owner@p.test");
    socket.close();
  });
  it("are hidden from members without demo.view", async () => {
    const c = await member("nodemo@p.test", {
      level: "Maker",
      revoke: ["demo.view"],
    });
    expect(await execute(c, "projects_list", {})).toMatchObject({ demo: [] });
    expect(
      await status(execute(c, "projects_get", { projectId: demo.project })),
    ).toBe(404);
  });
});

describe("Daily build limit", () => {
  it("refuses builds past the limit", async () => {
    const maker = await member("busy@p.test", { level: "Maker" });
    const own = await project(maker, "Busy");
    const limited: Context = {
      env: { ...env, DAILY_BUILD_LIMIT: "2" } as Env,
      identity: maker.identity,
    };
    for (let i = 0; i < 2; i++)
      await execute(limited, "models_build", { revisionId: own.revision });
    await expect(
      execute(limited, "models_build", { revisionId: own.revision }),
    ).rejects.toMatchObject({
      status: 429,
      message: "Daily build limit reached",
    });
  });
});
