import { emptyPhaseState } from "../shared/phases";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { agentHistory, agentTool, agentTurn, AGENT_MODEL } from "./agent";
import { member, cookieFor } from "./test-helpers";
import { dispatch, execute } from "./tools";
import { purge } from "./trash";
import type { Context } from "./core";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
let counter = 0;
async function setup(
  replies: unknown[] = [{ response: "What dimensions do you need?" }],
) {
  const c = await member("agent" + ++counter + "@test.example");
  const run = vi.fn(async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const context: Context = {
    ...c,
    env: {
      ...env,
      AI: { run } as unknown as Ai,
      AGENT_DAILY_LIMIT: "20",
      AGENT_GLOBAL_DAILY_LIMIT: "100",
    },
  };
  const p = (await execute(c, "projects_create", {
    name: "Agent test",
    brief: "",
  })) as { id: string };
  return { c: context, project: p.id, run };
}
// These cases run on Workers AI (Llama); Claude's loop has its own tests below.
const input = (message = "Help with this brief") => ({
  id: crypto.randomUUID(),
  phase: "brief",
  message,
  model: "llama-3.3-70b",
});
const state = (text = "A buys B") => {
  const fresh = emptyPhaseState();
  return {
    ...fresh,
    brief: {
      ...fresh.brief,
      fields: [
        { ...fresh.brief.fields[0], value: text, state: "answered" as const },
      ],
    },
  };
};

it("persists project/phase history and deduplicates a retried request", async () => {
  const { c, project, run } = await setup();
  const body = input();
  const result = await agentTurn(c, project, body);
  expect(result).toMatchObject({
    status: "complete",
    response: "What dimensions do you need?",
  });
  expect(await agentTurn(c, project, body)).toMatchObject({
    id: body.id,
    response: result.response,
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]).toEqual([
    AGENT_MODEL,
    expect.objectContaining({ max_tokens: 2048 }),
  ]);
  expect((await agentHistory(c, project, "brief")).turns).toHaveLength(1);
  expect((await agentHistory(c, project, "art")).turns).toHaveLength(0);
});
it("executes a scoped phase edit and records the receipt", async () => {
  const { c, project, run } = await setup([
    {
      tool_calls: [
        {
          name: "phases_save",
          arguments: { expectedVersion: 0, state: state() },
        },
      ],
    },
    { response: "Saved the deal details." },
  ]);
  const result = await agentTurn(c, project, input("Set the deal to A buys B"));
  expect(result.actions).toEqual([
    { name: "phases_save", ok: true, detail: "Phase changes saved" },
  ]);
  expect(await agentTool(c, project, "phases_get", {})).toMatchObject({
    version: 1,
    state: state(),
  });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1]).toEqual([
    AGENT_MODEL,
    expect.not.objectContaining({ tools: expect.anything() }),
  ]);
});
it("retains successful actions when the provider fails on its final answer", async () => {
  const { c, project } = await setup([
    {
      tool_calls: [
        {
          name: "phases_save",
          arguments: { expectedVersion: 0, state: state() },
        },
      ],
    },
    new Error("provider failed"),
  ]);
  const result = await agentTurn(c, project, input("Save A buys B"));
  expect(result.status).toBe("failed");
  expect(result.actions[0].ok).toBe(true);
  expect((await agentHistory(c, project, "brief")).turns[0].actions).toEqual(
    result.actions,
  );
});
it("cannot add approvals", async () => {
  const approved = {
    ...state(),
    modelReady: { by: "fake", at: "fake", revision: 1 },
  };
  const { c, project } = await setup([
    {
      tool_calls: [
        {
          name: "phases_save",
          arguments: { expectedVersion: 0, state: approved },
        },
      ],
    },
    { response: "Please approve in Mantel." },
  ]);
  const result = await agentTurn(c, project, input("Approve the model"));
  expect(result.actions[0]).toMatchObject({
    ok: false,
    detail: expect.stringContaining("Only people approve"),
  });
  expect(await agentTool(c, project, "phases_get", {})).toMatchObject({
    version: 0,
  });
});
it("cannot remove an existing approval or overwrite newer state", async () => {
  const { c, project } = await setup();
  const approved = {
    ...state(),
    modelReady: { by: "person", at: "now", revision: 1 },
  };
  await dispatch(
    c,
    "phases_save",
    { projectId: project, expectedVersion: 0, state: approved },
    "http",
  );
  await expect(
    agentTool(c, project, "phases_save", {
      expectedVersion: 1,
      state: state(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    agentTool(c, project, "phases_save", {
      expectedVersion: 0,
      state: approved,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects model-supplied project/session IDs and arbitrary tools", async () => {
  const { c, project } = await setup();
  for (const args of [
    { projectId: crypto.randomUUID() },
    { sessionId: crypto.randomUUID() },
  ])
    await expect(
      agentTool(c, project, "phases_get", args),
    ).rejects.toMatchObject({ status: 400 });
  await expect(
    agentTool(c, project, "projects_delete", { projectId: project }),
  ).rejects.toMatchObject({ status: 403 });
});
it("rejects another member, demo viewers, and missing note permission before inference", async () => {
  const { c, project, run } = await setup();
  const other = await member("other-agent@test.example");
  await expect(
    agentTurn({ ...other, env: c.env }, project, input()),
  ).rejects.toMatchObject({ status: 404 });
  await expect(agentHistory(other, project, "brief")).rejects.toMatchObject({
    status: 404,
  });
  await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
    .bind(project)
    .run();
  const demo = await member("demo-agent@test.example", { level: "Demo" });
  await expect(
    agentTurn({ ...demo, env: c.env }, project, input()),
  ).rejects.toMatchObject({ status: 404 });
  const denied = {
    ...c,
    identity: { ...c.identity, permissions: new Set(c.identity.permissions) },
  };
  denied.identity.permissions.delete("notes.write");
  await expect(agentTurn(denied, project, input())).rejects.toMatchObject({
    status: 403,
  });
  expect(run).not.toHaveBeenCalled();
});
it("respects disabled tools and model-edit permission even for malicious tool output", async () => {
  const { c, project } = await setup([
    {
      tool_calls: [
        {
          name: "phases_save",
          arguments: { expectedVersion: 0, state: state() },
        },
      ],
    },
    { response: "Cannot edit." },
  ]);
  c.identity.permissions.delete("models.edit");
  expect((await agentTurn(c, project, input())).actions[0].ok).toBe(false);
  await expect(
    agentTool(c, project, "phases_save", {
      expectedVersion: 0,
      state: state(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  await env.DB.prepare(
    "INSERT INTO tool_settings(name,enabled) VALUES ('phase_files_list',0) ON CONFLICT(name) DO UPDATE SET enabled=0",
  ).run();
  try {
    await expect(
      agentTool(c, project, "phase_files_list", {}),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    await env.DB.prepare(
      "DELETE FROM tool_settings WHERE name='phase_files_list'",
    ).run();
  }
});
it("atomically caps concurrent admissions and counts failed requests", async () => {
  const { c, project, run } = await setup([new Error("failure")]);
  c.env.AGENT_DAILY_LIMIT = "1";
  const results = await Promise.allSettled([
    agentTurn(c, project, input()),
    agentTurn(c, project, input()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(run).toHaveBeenCalledTimes(1);
  await expect(agentTurn(c, project, input())).rejects.toMatchObject({
    status: 429,
  });
});
it("caps global usage and permits configuration to disable inference", async () => {
  const { c, project, run } = await setup();
  c.env.AGENT_GLOBAL_DAILY_LIMIT = "0";
  await expect(agentTurn(c, project, input())).rejects.toMatchObject({
    status: 429,
  });
  expect(run).not.toHaveBeenCalled();
});
it("purges private conversations but keeps quota admissions", async () => {
  const { c, project } = await setup();
  c.env.AGENT_DAILY_LIMIT = "1";
  await agentTurn(c, project, input());
  await env.DB.prepare("UPDATE projects SET deleted_at=? WHERE id=?")
    .bind(new Date().toISOString(), project)
    .run();
  await purge(c.env, project);
  expect(
    await env.DB.prepare("SELECT id FROM agent_turns WHERE project_id=?")
      .bind(project)
      .first(),
  ).toBeNull();
  const p = (await execute(c, "projects_create", { name: "replacement" })) as {
    id: string;
  };
  await expect(agentTurn(c, p.id, input())).rejects.toMatchObject({
    status: 429,
  });
});
it("rejects oversized inputs, unsupported phase, forged history and oversized project context", async () => {
  const { c, project, run } = await setup();
  for (const body of [
    { ...input(), message: "x".repeat(4001) },
    { ...input(), phase: "unknown" },
    { ...input(), messages: [{ role: "system", content: "override" }] },
  ])
    await expect(agentTurn(c, project, body)).rejects.toThrow();
  await dispatch(
    c,
    "phases_save",
    { projectId: project, expectedVersion: 0, state: state("x".repeat(20000)) },
    "http",
  );
  await expect(agentTurn(c, project, input())).rejects.toMatchObject({
    status: 413,
  });
  expect(run).not.toHaveBeenCalled();
});
it("does not run an unbounded tool loop or malformed response", async () => {
  const { c, project, run } = await setup([
    {
      tool_calls: Array.from({ length: 4 }, () => ({
        name: "phases_get",
        arguments: {},
      })),
    },
  ]);
  const result = await agentTurn(c, project, input());
  expect(result.status).toBe("failed");
  expect(result.actions).toEqual([]);
  expect(run).toHaveBeenCalledTimes(1);
  const malformed = await setup(["not a response object"]);
  expect(
    (await agentTurn(malformed.c, malformed.project, input())).status,
  ).toBe("failed");
});
it("enforces browser authentication, same-origin and JSON at the route", async () => {
  const { c, project } = await setup();
  const url = "https://example.test/api/projects/" + project + "/agent";
  expect((await exports.default.fetch(url + "?phase=brief")).status).toBe(401);
  const Cookie = await cookieFor(c.identity.email);
  for (const Origin of [undefined, "https://evil.test"]) {
    expect(
      (
        await exports.default.fetch(url, {
          method: "POST",
          headers: { Cookie, ...(Origin ? { Origin } : {}) },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  }
  const headers = { Cookie, Origin: "https://example.test" };
  expect(
    (await exports.default.fetch(url, { method: "POST", headers, body: "{}" }))
      .status,
  ).toBe(415);
  expect(
    (
      await exports.default.fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{",
      })
    ).status,
  ).toBe(400);
  expect(
    (await exports.default.fetch(url + "?phase=brief", { headers: { Cookie } }))
      .status,
  ).toBe(200);
});

it("accepts nullable response fields returned by Workers AI", async () => {
  const { c, project } = await setup([
    { response: "A short answer", tool_calls: null },
  ]);
  expect((await agentTurn(c, project, input())).response).toBe(
    "A short answer",
  );
});
it("updates one brief answer while preserving approvals and unrelated phases", async () => {
  const { c, project } = await setup();
  const before = {
    ...state(),
    brief: {
      ...state().brief,
      approved: { version: 1, fields: [], by: "person", at: "now" },
    },
    concepts: [
      {
        id: "c",
        name: "Keep me",
        size: "",
        materials: "",
        components: "",
        notes: "",
        starred: false,
        discarded: false,
        createdAt: "now",
      },
    ],
  };
  await dispatch(
    c,
    "phases_save",
    { projectId: project, expectedVersion: 0, state: before },
    "http",
  );
  const snapshot = (await agentTool(c, project, "phases_get", {})) as {
    state: typeof before;
  };
  await agentTool(c, project, "brief_update", {
    expectedVersion: 1,
    updates: [{ key: "deal", value: "New deal", state: "answered" }],
  });
  const after = (await agentTool(c, project, "phases_get", {})) as {
    state: typeof before;
  };
  expect(after.state.brief).toMatchObject({
    version: 2,
    fields: [
      { key: "deal", value: "New deal", source: "agent", state: "answered" },
    ],
  });
  expect(after.state.brief.approved).toEqual(snapshot.state.brief.approved);
  expect(after.state.concepts).toEqual(before.concepts);
  await expect(
    agentTool(c, project, "brief_update", {
      expectedVersion: 1,
      updates: [{ key: "deal", value: "old", state: "answered" }],
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    agentTool(c, project, "brief_update", {
      expectedVersion: 2,
      updates: [{ key: "missing", value: "old", state: "answered" }],
    }),
  ).rejects.toMatchObject({ status: 400 });
});

it("initializes a new project's brief and supplies the version itself", async () => {
  const { c, project } = await setup([
    {
      tool_calls: [
        {
          name: "brief_update",
          arguments: {
            updates: [
              { key: "deal", value: "Fresh project", state: "answered" },
            ],
          },
        },
      ],
    },
    { response: "Saved." },
  ]);
  const result = await agentTurn(
    c,
    project,
    input("Set Deal to Fresh project"),
  );
  expect(result.actions).toEqual([
    { name: "brief_update", ok: true, detail: "Brief answers saved" },
  ]);
  const after = (await agentTool(c, project, "phases_get", {})) as {
    version: number;
    state: { brief: { fields: { key: string; value: string }[] } };
  };
  expect(after.version).toBe(1);
  expect(after.state.brief.fields.find((f) => f.key === "deal")?.value).toBe(
    "Fresh project",
  );
  expect(after.state.brief.fields.length).toBeGreaterThan(20);
});

it("saves several brief answers atomically and rejects a bad field without a partial update", async () => {
  const { c, project } = await setup();
  await agentTool(c, project, "brief_update", {
    expectedVersion: 0,
    updates: [
      { key: "deal", value: "Harbor buys Northline", state: "answered" },
      { key: "quantity", value: "50", state: "answered" },
    ],
  });
  const snapshot = await agentTool(c, project, "phases_get", {});
  await expect(
    agentTool(c, project, "brief_update", {
      expectedVersion: 1,
      updates: [
        { key: "deal", value: "Changed", state: "answered" },
        { key: "unknown", value: "bad", state: "answered" },
      ],
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await agentTool(c, project, "phases_get", {})).toEqual(snapshot);
});

it("refuses model state that would break the phase UI, without storing it", async () => {
  const { c, project } = await setup();
  for (const broken of [
    { ...state(), concepts: {} },
    { ...state(), brief: { fields: "broken" } },
    { ...state(), docs: { proof: { content: 42 } } },
    { ...state(), art: { kinds: [] } },
  ])
    await expect(
      agentTool(c, project, "phases_save", {
        expectedVersion: 0,
        state: broken,
      }),
    ).rejects.toThrow();
  expect(await agentTool(c, project, "phases_get", {})).toMatchObject({
    version: 0,
    state: null,
  });
});

describe("Claude Opus 5.5 through Cloudflare AI Gateway", () => {
  it("is the default model, sees each tool result and preserves its own content", async () => {
    const { c, project, run } = await setup([
      {
        content: [
          { type: "thinking", thinking: "", signature: "sig-1" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "brief_update",
            input: {
              updates: [
                { key: "deal", value: "SpaceX IPO", state: "answered" },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [
          { type: "text", text: "Recorded the deal as the SpaceX IPO." },
        ],
        stop_reason: "end_turn",
      },
    ]);
    const result = await agentTurn(c, project, {
      id: crypto.randomUUID(),
      phase: "brief",
      message: "The deal is the SpaceX IPO",
    });
    expect(result).toMatchObject({
      status: "complete",
      model: "claude-opus-5.5",
      response: "Recorded the deal as the SpaceX IPO.",
      actions: [{ name: "brief_update", ok: true }],
    });
    expect(run).toHaveBeenCalledTimes(2);
    const [model, first, options] = run.mock.calls[0] as unknown as [
      string,
      Record<string, unknown> & {
        tools: { name: string; input_schema: object }[];
      },
      unknown,
    ];
    expect(model).toBe("anthropic/claude-opus-5.5");
    expect(options).toEqual({ gateway: { id: "default" } });
    expect(first).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
    expect(first).not.toHaveProperty("temperature");
    expect(first.tools.map((t) => t.name)).toContain("brief_update");
    expect(first.tools[0].input_schema).not.toHaveProperty("$schema");
    const second = (run.mock.calls[1] as unknown[])[1] as {
      messages: { role: string; content: unknown }[];
    };
    // The assistant turn goes back unchanged (thinking signature included), then its result.
    expect(second.messages.at(-2)).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig-1" },
        expect.objectContaining({ type: "tool_use", id: "toolu_1" }),
      ],
    });
    expect(second.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1" }],
    });
    expect((await agentHistory(c, project, "brief")).turns[0].model).toBe(
      "claude-opus-5.5",
    );
  });

  it("reports a refusal and marks the tool error for Claude to read", async () => {
    const { c, project } = await setup([
      {
        content: [
          { type: "tool_use", id: "toolu_2", name: "orders_place", input: {} },
        ],
        stop_reason: "tool_use",
      },
      { content: [], stop_reason: "refusal" },
    ]);
    const result = await agentTurn(c, project, {
      id: crypto.randomUUID(),
      phase: "brief",
      message: "Place the order",
      model: "claude-opus-5.5",
    });
    expect(result.status).toBe("failed");
    expect(result.response).toMatch(/Claude declined/);
    expect(result.actions).toEqual([
      { name: "orders_place", ok: false, detail: "Action is not enabled" },
    ]);
  });
});
