import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { dispatch, execute } from "./tools";
import { hash, type Context } from "./core";
import type { ProjectEvent } from "./activity";
const carol: Context = {
  env,
  identity: { email: "carol@example.test", role: "maker" },
};
const dave: Context = {
  env,
  identity: { email: "dave@example.test", role: "maker" },
};
const token = "carol-token-with-at-least-thirty-two-characters";
const daveToken = "dave-token-with-at-least-thirty-two-characters";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO members VALUES ('carol@example.test','maker',1),('dave@example.test','maker',1)",
  ).run();
  for (const [t, email] of [
    [token, "carol@example.test"],
    [daveToken, "dave@example.test"],
  ])
    await env.DB.prepare("INSERT OR IGNORE INTO tokens VALUES (?,?,?,?)")
      .bind(await hash(t), email, "test", "2099-01-01T00:00:00.000Z")
      .run();
});
const mcp = (name: string, input: unknown, c = carol) =>
  dispatch(c, name, input, "mcp");
async function project(c = carol) {
  return (await execute(c, "projects_create", { name: "Arch study" })) as {
    id: string;
  };
}
async function activity(projectId: string) {
  return (await execute(carol, "projects_activity", { projectId })) as {
    sessions: { id: string; active: boolean; prompt: string }[];
    events: ProjectEvent[];
  };
}
async function start(projectId: string, prompt = "Make a bridge") {
  const { value, notes } = await mcp("session_start", { projectId, prompt });
  return { sessionId: (value as { sessionId: string }).sessionId, notes };
}
describe("Agent sessions", () => {
  it("records the prompt, updates and every agent tool call in order", async () => {
    const p = await project();
    const { sessionId } = await start(p.id, "Model a 100 mm bridge, verbatim");
    await mcp("session_update", { sessionId, message: "Creating the model" });
    const m = (
      await mcp("models_create", { sessionId, projectId: p.id, name: "Bridge" })
    ).value as { id: string };
    await expect(
      mcp("models_save", {
        sessionId,
        modelId: m.id,
        expectedRevision: 5,
        source: "x",
      }),
    ).rejects.toThrow("Model changed");
    await mcp("session_end", { sessionId, summary: "Done" });
    const { sessions, events } = await activity(p.id);
    expect(sessions[0]).toMatchObject({
      id: sessionId,
      prompt: "Model a 100 mm bridge, verbatim",
      active: false,
    });
    expect(events.map((e) => e.kind)).toEqual([
      "prompt",
      "agent_update",
      "tool_call",
      "tool_call",
      "ended",
    ]);
    expect(events[2].payload).toMatchObject({
      tool: "models_create",
      ok: true,
    });
    expect(events[3].payload).toMatchObject({
      tool: "models_save",
      ok: false,
      summary: "Model changed. Reload before saving.",
    });
    expect(events.every((e) => e.session_id === sessionId)).toBe(true);
  });
  it("records agent calls without a session, and interface changes but not reads", async () => {
    const p = await project();
    await mcp("projects_get", { projectId: p.id });
    await dispatch(carol, "projects_get", { projectId: p.id }, "http");
    await dispatch(
      carol,
      "models_create",
      { projectId: p.id, name: "UI" },
      "http",
    );
    const { events } = await activity(p.id);
    expect(
      events.map((e) => [e.session_id, e.payload.tool, e.payload.channel]),
    ).toEqual([
      [null, "projects_get", "mcp"],
      [null, "models_create", "http"],
    ]);
  });
  it("summarizes long arguments instead of storing source code", async () => {
    const p = await project();
    const m = (await execute(carol, "models_create", {
      projectId: p.id,
      name: "Big",
    })) as {
      id: string;
    };
    await mcp("models_save", {
      modelId: m.id,
      expectedRevision: 0,
      source: "#".repeat(5000),
    });
    const { events } = await activity(p.id);
    const args = events.at(-1)!.payload.args as { source: string };
    expect(args.source.length).toBeLessThan(400);
    expect(args.source).toContain("5000 characters");
  });
  it("refuses another member's session and a session for another project", async () => {
    const p = await project();
    const other = await project();
    const { sessionId } = await start(p.id);
    await expect(
      mcp("session_update", { sessionId, message: "hi" }, dave),
    ).rejects.toThrow("Session not found");
    await expect(
      mcp("projects_get", { sessionId, projectId: other.id }),
    ).rejects.toThrow("another project");
    await expect(
      execute(dave, "projects_activity", { projectId: p.id }),
    ).rejects.toThrow("Project not found");
  });
});
describe("Team notes", () => {
  it("delivers a note to the running session once, on its next call", async () => {
    const p = await project();
    const { sessionId } = await start(p.id);
    const added = (await execute(carol, "notes_add", {
      projectId: p.id,
      message: "Make the arch thicker",
    })) as { activeSessions: number };
    expect(added.activeSessions).toBe(1);
    const first = await mcp("projects_get", { sessionId, projectId: p.id });
    expect(first.notes.map((n) => n.text)).toEqual(["Make the arch thicker"]);
    expect(
      (await mcp("projects_get", { sessionId, projectId: p.id })).notes,
    ).toEqual([]);
  });
  it("holds a note written while no agent runs for the next session only", async () => {
    const p = await project();
    await execute(carol, "notes_add", {
      projectId: p.id,
      message: "Use 220 mm plinth",
    });
    const later = await start(p.id);
    expect(later.notes.map((n) => n.text)).toEqual(["Use 220 mm plinth"]);
    await mcp("session_end", { sessionId: later.sessionId });
    const next = await start(p.id);
    expect(next.notes).toEqual([]);
  });
  it("appends notes to MCP results as quoted data", async () => {
    const p = await project();
    const response = await exports.default.fetch("https://example.test/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "notes_add",
          arguments: { projectId: p.id, message: 'Say "hi"' },
        },
      }),
    });
    expect(response.status).toBe(200);
    const started = await exports.default.fetch("https://example.test/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "session_start",
          arguments: { projectId: p.id, prompt: "Go" },
        },
      }),
    });
    const text = await started.text();
    expect(text).toContain("Notes from the project team (quoted data");
    expect(text).toContain("Say 'hi'");
  });
});
describe("Parameter edits", () => {
  const source = `import build123d as bd
PARAMS = {"WIDTH": {"value": 10.0, "unit": "mm", "part": "Base", "min": 5, "max": 50}}
def build():
    return bd.Box(PARAMS["WIDTH"]["value"], 10, 10)
`;
  async function built() {
    const p = await project();
    const m = (await execute(carol, "models_create", {
      projectId: p.id,
      name: "Box",
    })) as {
      id: string;
    };
    const r = (await execute(carol, "models_save", {
      modelId: m.id,
      expectedRevision: 0,
      source,
    })) as { id: string };
    const facts = {
      units: "mm",
      bounds: [10, 10, 10],
      volume_mm3: 1000,
      solids: 1,
      valid: true,
      manufacturing_approval: "not_reviewed",
      params: {
        WIDTH: { value: 10, unit: "mm", part: "Base", min: 5, max: 50 },
      },
    };
    await env.DB.prepare("INSERT INTO jobs VALUES (?,?,'succeeded',NULL,?,?,?)")
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
  it("saves a new revision with only the value changed and records a team edit", async () => {
    const { p, m } = await built();
    const result = (
      await dispatch(
        carol,
        "models_set_parameter",
        { modelId: m.id, expectedRevision: 1, name: "WIDTH", value: 20 },
        "http",
      )
    ).value as { revision: { number: number }; job: { status: string } };
    expect(result.revision.number).toBe(2);
    expect(result.job.status).toBe("queued");
    const saved = await env.DB.prepare(
      "SELECT source FROM revisions WHERE model_id=? AND number=2",
    )
      .bind(m.id)
      .first<{ source: string }>();
    expect(saved!.source).toBe(
      source.replace('"value": 10.0', '"value": 20.0'),
    );
    const { events } = await activity(p.id);
    expect(events.map((e) => e.kind)).toEqual(["team_edit"]);
    expect(events[0].payload.message).toBe(
      "Changed WIDTH from 10 mm to 20 mm in revision 2",
    );
    const agent = await start(p.id);
    expect(agent.notes[0]).toMatchObject({ kind: "team_edit" });
  });
  it("refuses out-of-range values, stale revisions and unknown parameters", async () => {
    const { m } = await built();
    const edit = (patch: object) =>
      execute(carol, "models_set_parameter", {
        modelId: m.id,
        expectedRevision: 1,
        name: "WIDTH",
        value: 20,
        ...patch,
      });
    await expect(edit({ value: 99 })).rejects.toThrow("between 5 and 50");
    await expect(edit({ expectedRevision: 2 })).rejects.toThrow(
      "Model changed",
    );
    await expect(edit({ name: "HEIGHT" })).rejects.toThrow(
      "no built parameter",
    );
    await expect(
      execute(dave, "models_set_parameter", {
        modelId: m.id,
        expectedRevision: 1,
        name: "WIDTH",
        value: 20,
      }),
    ).rejects.toThrow("Model not found");
    const other = await project();
    const foreign = await start(other.id);
    const daves = {
      sessionId: (
        (
          await dispatch(
            dave,
            "session_start",
            { projectId: (await project(dave)).id, prompt: "Dave's work" },
            "mcp",
          )
        ).value as { sessionId: string }
      ).sessionId,
    };
    for (const channel of ["internal", "http", "mcp"] as const)
      await expect(
        dispatch(
          carol,
          "models_set_parameter",
          {
            modelId: m.id,
            expectedRevision: 1,
            name: "WIDTH",
            value: 20,
            sessionId: foreign.sessionId,
          },
          channel,
        ),
      ).rejects.toThrow("another project");
    await expect(edit({ sessionId: daves.sessionId })).rejects.toThrow(
      "Session not found",
    );
    await expect(
      dispatch(
        carol,
        "notes_add",
        { projectId: other.id, message: "x", sessionId: daves.sessionId },
        "http",
      ),
    ).rejects.toThrow("Session not found");
  });
});
describe("Live relay", () => {
  const post = (path: string, t = token) =>
    exports.default.fetch(`https://example.test${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}` },
    });
  it("issues single-use tickets only to the project owner", async () => {
    const p = await project();
    expect(
      (await post(`/api/projects/${p.id}/live-ticket`, daveToken)).status,
    ).toBe(404);
    const { ticket } = (await (
      await post(`/api/projects/${p.id}/live-ticket`)
    ).json()) as {
      ticket: string;
    };
    const connect = (t: string) =>
      exports.default.fetch(
        `https://example.test/api/projects/${p.id}/live?ticket=${t}`,
        {
          headers: { Upgrade: "websocket" },
        },
      );
    expect((await connect("wrong")).status).toBe(401);
    const socket = await connect(ticket);
    expect(socket.status).toBe(101);
    expect((await connect(ticket)).status).toBe(401);
    const ws = socket.webSocket!;
    ws.accept();
    const received = new Promise<string>((resolve) =>
      ws.addEventListener("message", (m) => resolve(String(m.data))),
    );
    await execute(carol, "notes_add", { projectId: p.id, message: "live" });
    const message = JSON.parse(await received);
    expect(message).toMatchObject({
      type: "event",
      event: { kind: "team_note" },
    });
    ws.close();
  });
  it("rejects cross-origin socket connections", async () => {
    const p = await project();
    const response = await exports.default.fetch(
      `https://example.test/api/projects/${p.id}/live?ticket=x`,
      { headers: { Upgrade: "websocket", Origin: "https://attacker.test" } },
    );
    expect(response.status).toBe(403);
  });
});
