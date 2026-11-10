import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./core";
import { dispatch, execute } from "./tools";
import { purge } from "./trash";
import { cookieFor, member } from "./test-helpers";
import { approvals, changedApprovals } from "./phase-rules";

const origin = "https://example.test";
let alice: Context;
let viewer: Context;

const mcp = (c: Context, name: string, input: unknown) =>
  dispatch(c, name, input, "mcp").then((r) => r.value);
const http = (c: Context, name: string, input: unknown) =>
  dispatch(c, name, input, "http").then((r) => r.value);

async function project(name: string, demo = false) {
  const p = (await execute(alice, "projects_create", { name, brief: "" })) as {
    id: string;
  };
  if (demo)
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
  return p.id;
}
const brief = (approved?: { by: string; at: string }) => ({
  brief: {
    version: 1,
    fields: [{ key: "deal", value: "A buys B", state: "answered" }],
    files: [],
    ...(approved ? { approved: { version: 1, fields: [], ...approved } } : {}),
  },
  concepts: [],
  docs: {},
  suppliers: [],
});

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  alice = await member("alice@ph.test");
  viewer = await member("viewer@ph.test", { level: "Demo" });
});

describe("phase rules", () => {
  it("finds every approval and what changed", () => {
    const s = {
      brief: { approved: { by: "a", at: "1" } },
      decision: {
        by: "a",
        at: "1",
        conceptId: "c",
        questions: [{ id: "q1", resolved: { by: "a", at: "1" } }],
      },
      modelReady: { by: "a", at: "1", revision: 2 },
      docs: { proof: { approved: { by: "a", at: "1" } }, parts: {} },
    };
    expect([...approvals(s).keys()].sort()).toEqual([
      "brief.approved",
      "decision",
      "decision.questions.q1.resolved",
      "docs.proof.approved",
      "modelReady",
    ]);
    const next = structuredClone(s);
    next.modelReady.revision = 3;
    next.decision.questions.push({ id: "q2", resolved: { by: "a", at: "2" } });
    expect(changedApprovals(s, next).sort()).toEqual([
      "decision.questions.q2.resolved",
      "modelReady",
    ]);
  });
});

describe("phases", () => {
  it("starts empty and saves versions", async () => {
    const p = await project("Phases A");
    expect(await http(alice, "phases_get", { projectId: p })).toEqual({
      state: null,
      version: 0,
      updatedAt: null,
    });
    const v1 = (await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: brief(),
    })) as { version: number };
    expect(v1.version).toBe(1);
    const got = (await http(alice, "phases_get", { projectId: p })) as {
      state: ReturnType<typeof brief>;
      version: number;
    };
    expect(got.version).toBe(1);
    expect(got.state.brief.fields[0].value).toBe("A buys B");
  });

  it("refuses a save made against an old version", async () => {
    const p = await project("Phases B");
    await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: brief(),
    });
    await expect(
      http(alice, "phases_save", {
        projectId: p,
        expectedVersion: 0,
        state: brief(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("records a person's approval with their name and the server's time", async () => {
    const p = await project("Phases C");
    const saved = (await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: brief({ by: "someone-else@x.test", at: "1999-01-01T00:00:00Z" }),
    })) as {
      state: ReturnType<typeof brief> & {
        brief: { approved: { by: string; at: string } };
      };
    };
    expect(saved.state.brief.approved.by).toBe("alice@ph.test");
    expect(saved.state.brief.approved.at).not.toBe("1999-01-01T00:00:00Z");
  });

  it("refuses an agent's save that adds, changes or removes an approval", async () => {
    const p = await project("Phases D");
    await expect(
      mcp(alice, "phases_save", {
        projectId: p,
        expectedVersion: 0,
        state: brief({ by: "alice@ph.test", at: "x" }),
      }),
    ).rejects.toMatchObject({ status: 403 });
    // A person approves; the agent may then save other changes, but not drop the approval.
    const saved = (await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: brief({ by: "alice@ph.test", at: "x" }),
    })) as { state: ReturnType<typeof brief>; version: number };
    const edited = structuredClone(saved.state);
    edited.brief.fields[0].value = "A buys B and C";
    await expect(
      mcp(alice, "phases_save", {
        projectId: p,
        expectedVersion: saved.version,
        state: edited,
      }),
    ).resolves.toMatchObject({ version: 2 });
    const dropped = structuredClone(edited) as {
      brief: { approved?: unknown };
    };
    delete dropped.brief.approved;
    await expect(
      mcp(alice, "phases_save", {
        projectId: p,
        expectedVersion: 2,
        state: dropped,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("counts any value in an approval slot as an approval", async () => {
    const p = await project("Phases bypass");
    // No `by`: still an approval, so an agent can't write one.
    for (const state of [
      { ...brief(), brief: { ...brief().brief, approved: { version: 1 } } },
      { ...brief(), modelReady: { revision: 9 } },
      {
        ...brief(),
        docs: { proof: { content: "x", approved: { revision: 1 } } },
      },
    ])
      await expect(
        mcp(alice, "phases_save", { projectId: p, expectedVersion: 0, state }),
      ).rejects.toMatchObject({ status: 403 });
    // From a person, the same save is stamped.
    const saved = (await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: { ...brief(), modelReady: { revision: 9 } },
    })) as { state: { modelReady: { by: string; revision: number } } };
    expect(saved.state.modelReady).toMatchObject({
      by: "alice@ph.test",
      revision: 9,
    });
  });

  it("refuses states whose approvals can't be read unambiguously", async () => {
    const p = await project("Phases shapes");
    const bad = [
      { ...brief(), modelReady: "yes" },
      { ...brief(), docs: { "proof.approved": {} } },
      { ...brief(), decision: { conceptId: "c", questions: [{ id: "a.b" }] } },
      {
        ...brief(),
        decision: { conceptId: "c", questions: [{ id: "q" }, { id: "q" }] },
      },
      {
        ...brief(),
        decision: { conceptId: "c", questions: [{ text: "no id" }] },
      },
    ];
    for (const state of bad)
      await expect(
        http(alice, "phases_save", { projectId: p, expectedVersion: 0, state }),
      ).rejects.toMatchObject({ status: 400 });
  });

  it("lets an agent add and edit questions without touching the decision", async () => {
    const p = await project("Phases questions");
    const decision = {
      conceptId: "c1",
      qualities: [],
      targets: "",
      briefVersion: 0,
      questions: [] as unknown[],
    };
    const saved = (await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: { ...brief(), decision },
    })) as { state: { decision: typeof decision }; version: number };
    const next = structuredClone(saved.state);
    next.decision.questions.push({
      id: "q1",
      text: "Cable gauge?",
      owner: "maker",
    });
    await expect(
      mcp(alice, "phases_save", {
        projectId: p,
        expectedVersion: saved.version,
        state: next,
      }),
    ).resolves.toMatchObject({ version: 2 });
    const resolved = structuredClone(next) as {
      decision: { questions: { resolved?: unknown }[] };
    };
    resolved.decision.questions[0].resolved = { by: "alice@ph.test", at: "x" };
    await expect(
      mcp(alice, "phases_save", {
        projectId: p,
        expectedVersion: 2,
        state: resolved,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lets demo viewers read without seeing who approved, and not write", async () => {
    const p = await project("Phases demo", true);
    await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: brief({ by: "alice@ph.test", at: "x" }),
    });
    const got = (await http(viewer, "phases_get", { projectId: p })) as {
      state: { brief: { approved: { by: string } } };
      updatedBy: string;
    };
    expect(got.state.brief.approved.by).toBe("");
    expect(got.updatedBy).toBe("");
    await expect(
      http(viewer, "phases_save", {
        projectId: p,
        expectedVersion: 1,
        state: brief(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("limits the size of the state", async () => {
    const p = await project("Phases big");
    await expect(
      http(alice, "phases_save", {
        projectId: p,
        expectedVersion: 0,
        state: { ...brief(), blob: "x".repeat(130_000) },
      }),
    ).rejects.toMatchObject({ status: 413 });
  });
});

describe("phase files", () => {
  it("uploads, lists, serves sandboxed and is purged with the project", async () => {
    const p = await project("Phases files");
    const cookie = await cookieFor("alice@ph.test");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const up = await exports.default.fetch(
      `${origin}/api/projects/${p}/phase-files?phase=brief&name=logo.svg`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "image/svg+xml",
        },
        body: svg,
      },
    );
    expect(up.status).toBe(200);
    const file = (await up.json()) as { id: string; url: string; size: number };
    expect(file.size).toBe(svg.length);
    const listed = (await http(alice, "phase_files_list", {
      projectId: p,
      phase: "brief",
    })) as { files: { id: string }[] };
    expect(listed.files.map((f) => f.id)).toEqual([file.id]);

    const got = await exports.default.fetch(`${origin}${file.url}`, {
      headers: { Cookie: cookie },
    });
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await got.text()).toBe(svg);

    // Someone who can't see the project can't fetch its files.
    const other = await member("other@ph.test");
    const theirs = await exports.default.fetch(`${origin}${file.url}`, {
      headers: { Cookie: await cookieFor(other.identity.email) },
    });
    expect(theirs.status).toBe(404);

    // Uploads need the app's own origin and a phase.
    const crossSite = await exports.default.fetch(
      `${origin}/api/projects/${p}/phase-files?phase=brief&name=x.png`,
      { method: "POST", headers: { Cookie: cookie }, body: "x" },
    );
    expect(crossSite.status).toBe(403);
    const tooBig = await exports.default.fetch(
      `${origin}/api/projects/${p}/phase-files?phase=brief&name=big.bin`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/octet-stream",
        },
        body: new ReadableStream({
          start(controller) {
            const chunk = new Uint8Array(1024 * 1024);
            for (let i = 0; i < 26; i++) controller.enqueue(chunk);
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit,
    );
    expect(tooBig.status).toBe(413);
    const noPhase = await exports.default.fetch(
      `${origin}/api/projects/${p}/phase-files?name=x.png`,
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
        body: "x",
      },
    );
    expect(noPhase.status).toBe(400);

    await http(alice, "phases_save", {
      projectId: p,
      expectedVersion: 0,
      state: brief(),
    });
    await execute(alice, "projects_delete", {
      projectId: p,
      name: "Phases files",
    });
    await purge(env, p);
    const rows = await env.DB.prepare(
      "SELECT (SELECT count(*) FROM phase_files WHERE project_id=?1) AS f, (SELECT count(*) FROM phase_states WHERE project_id=?1) AS s",
    )
      .bind(p)
      .first<{ f: number; s: number }>();
    expect(rows).toEqual({ f: 0, s: 0 });
    expect(await env.ARTIFACTS.get(`phases/${p}/${file.id}`)).toBeNull();
  });
});
