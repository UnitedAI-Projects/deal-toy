import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import bridge from "../../examples/bridge.py";
import record from "../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import { consume } from "./builds";
import type { Context } from "./core";
import { execute } from "./tools";
import { cookieFor, member } from "./test-helpers";

let carol: Context;
let dave: Context;
let viewer: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-inspect@example.test", { level: "Maker" });
  dave = await member("dave-inspect@example.test", { level: "Maker" });
  viewer = await member("viewer-inspect@example.test", { level: "Demo" });
});
const facts = {
  units: "mm",
  bounds: [1, 2, 3],
  volume_mm3: 6,
  solids: 1,
  valid: true,
  manufacturing_approval: "not_reviewed",
};

async function built(inspect: unknown = record) {
  const p = (await execute(carol, "projects_create", { name: "Inspect" })) as {
    id: string;
  };
  const m = (await execute(carol, "models_create", {
    projectId: p.id,
    name: "Toy",
  })) as { id: string };
  const r = (await execute(carol, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source: bridge,
  })) as { id: string };
  const job = (await execute(carol, "models_build", { revisionId: r.id })) as {
    id: string;
  };
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
          ? JSON.stringify(inspect)
          : "bytes",
    ),
  }));
  const container = {
    fetch: vi.fn(async () => Response.json({ artifacts })),
    destroy: vi.fn(async () => {}),
  };
  await consume(
    {
      body: { jobId: job.id },
      ack: vi.fn(),
      retry: vi.fn(),
    } as unknown as Message<unknown>,
    {
      DB: env.DB,
      ARTIFACTS: env.ARTIFACTS,
      CAD: { getByName: () => container },
    } as unknown as Env,
  );
  return { p, m, job };
}

describe("inspection record", () => {
  it("stores inspect.json with a build and returns it whole or in slices", async () => {
    const { job } = await built();
    const result = (await execute(carol, "builds_get", { jobId: job.id })) as {
      status: string;
      artifacts: { name: string }[];
    };
    expect(result.status).toBe("succeeded");
    expect(result.artifacts.map((a) => a.name)).toContain("inspect.json");
    const whole = (await execute(carol, "inspect_get", {
      jobId: job.id,
    })) as typeof record;
    expect(whole.embeds[0].wall).toBeCloseTo(1.5, 6);
    const slice = (await execute(carol, "inspect_get", {
      jobId: job.id,
      sections: ["stability", "embeds"],
      faces: [0, 1],
    })) as Record<string, unknown> & { faces: { index: number }[] };
    expect(Object.keys(slice).sort()).toEqual(["embeds", "faces", "stability"]);
    expect(slice.faces.map((f) => f.index)).toEqual([0, 1]);
  });
  it("lets demo viewers read it, and hides private projects", async () => {
    const { p, job } = await built();
    await expect(
      execute(dave, "inspect_get", { jobId: job.id }),
    ).rejects.toThrow("Revision not found");
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
    await expect(
      execute(viewer, "inspect_get", { jobId: job.id, sections: ["parts"] }),
    ).resolves.toMatchObject({
      parts: expect.any(Array),
    });
    const artifact = (await execute(carol, "builds_get", {
      jobId: job.id,
    })) as {
      artifacts: { id: string; name: string }[];
    };
    const id = artifact.artifacts.find((a) => a.name === "inspect.json")!.id;
    const response = await exports.default.fetch(
      `https://example.test/api/artifacts/${id}`,
      {
        headers: { Cookie: await cookieFor("viewer-inspect@example.test") },
      },
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as typeof record).version).toBe(1);
  });
  it("fails a build whose record is too large or malformed", async () => {
    const huge = {
      ...record,
      faces: Array.from({ length: 30000 }, (_, i) => ({
        ...record.faces[0],
        index: i,
        pad: "x".repeat(150),
      })),
    };
    const { job } = await built(huge);
    const result = (await execute(carol, "builds_get", { jobId: job.id })) as {
      status: string;
      error: string;
    };
    expect(result.status).toBe("failed");
    expect(result.error).toContain("inspect.json");
    const bad = await built({ version: 2 });
    expect(
      (
        (await execute(carol, "builds_get", { jobId: bad.job.id })) as {
          status: string;
        }
      ).status,
    ).toBe("failed");
  });
});

describe("view_highlight", () => {
  const spying = (c: Context) => {
    const broadcast = vi.fn(async () => {});
    return {
      broadcast,
      context: {
        ...c,
        env: { ...c.env, LIVE: { getByName: () => ({ broadcast }) } },
      } as unknown as Context,
    };
  };
  async function session(c: Context, projectId: string) {
    const { dispatch } = await import("./tools");
    const { value } = await dispatch(
      c,
      "session_start",
      { projectId, prompt: "Check the coin wall" },
      "mcp",
    );
    return (value as { sessionId: string }).sessionId;
  }
  it("broadcasts the highlight and records the agent's message", async () => {
    const { p, job } = await built();
    const sessionId = await session(carol, p.id);
    const { broadcast, context } = spying(carol);
    await execute(context, "view_highlight", {
      sessionId,
      jobId: job.id,
      faces: [1],
      parts: ["Coin"],
      message: "The coin is 1.5 mm behind this face",
    });
    const sent = (broadcast.mock.calls as unknown as [string, string][]).map(
      ([full]) => JSON.parse(full),
    );
    expect(sent).toContainEqual({
      type: "highlight",
      jobId: job.id,
      faces: [1],
      parts: ["Coin"],
      message: "The coin is 1.5 mm behind this face",
    });
    const { events } = (await execute(carol, "projects_activity", {
      projectId: p.id,
    })) as {
      events: { kind: string; payload: { message?: string } }[];
    };
    expect(
      events.some(
        (e) =>
          e.kind === "agent_update" &&
          e.payload.message === "The coin is 1.5 mm behind this face",
      ),
    ).toBe(true);
  });
  it("refuses faces and parts the build does not have", async () => {
    const { p, job } = await built();
    const sessionId = await session(carol, p.id);
    await expect(
      execute(carol, "view_highlight", {
        sessionId,
        jobId: job.id,
        faces: [9999],
      }),
    ).rejects.toThrow("No face 9999");
    await expect(
      execute(carol, "view_highlight", {
        sessionId,
        jobId: job.id,
        parts: ["Ghost"],
      }),
    ).rejects.toThrow('No part "Ghost"');
  });
  it("refuses demo viewers and sessions on another project, broadcasting nothing", async () => {
    const { p, job } = await built();
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
    const other = await built();
    const otherSession = await session(carol, other.p.id);
    const { broadcast, context } = spying(viewer);
    await expect(
      execute(context, "view_highlight", {
        sessionId: otherSession,
        jobId: job.id,
        faces: [1],
      }),
    ).rejects.toThrow();
    const mine = spying(carol);
    await expect(
      execute(mine.context, "view_highlight", {
        sessionId: otherSession,
        jobId: job.id,
        faces: [1],
      }),
    ).rejects.toThrow("Session belongs to another project");
    expect(broadcast).not.toHaveBeenCalled();
    expect(mine.broadcast).not.toHaveBeenCalled();
  });
});

describe("view_highlight summary", () => {
  it("logs what the agent pointed at in plain words", async () => {
    const { p, job } = await built();
    const { dispatch } = await import("./tools");
    const { value } = await dispatch(
      carol,
      "session_start",
      { projectId: p.id, prompt: "Point" },
      "mcp",
    );
    const sessionId = (value as { sessionId: string }).sessionId;
    await dispatch(
      carol,
      "view_highlight",
      { sessionId, jobId: job.id, faces: [1, 2], parts: ["Coin"] },
      "mcp",
    );
    const { events } = (await execute(carol, "projects_activity", {
      projectId: p.id,
    })) as {
      events: { kind: string; payload: { summary?: string } }[];
    };
    expect(events.map((e) => e.payload.summary)).toContain(
      "Pointed at 2 faces, Coin",
    );
  });
});

describe("selection_set", () => {
  const base = { ref: "face", of: "Base", name: "bottom" };
  const coin = { ref: "part", label: "Coin" };
  it("puts the owner's selection in the agent's context, and clears it", async () => {
    const { m } = await built();
    const { dispatch } = await import("./tools");
    const { modelContext } = await import("./actions/summary");
    await dispatch(
      carol,
      "selection_set",
      { modelId: m.id, refs: [base, coin] },
      "http",
    );
    expect(await modelContext(carol, m.id)).toContain(
      'Selected: m.face("Base", "bottom") · m.part("Coin")',
    );
    await dispatch(carol, "selection_set", { modelId: m.id, refs: [] }, "http");
    expect(await modelContext(carol, m.id)).not.toContain("Selected:");
  });
  it("leaves out old selections and viewers' selections, and refuses bad input", async () => {
    const { p, m } = await built();
    const { dispatch } = await import("./tools");
    const { modelContext } = await import("./actions/summary");
    await dispatch(
      carol,
      "selection_set",
      { modelId: m.id, refs: [base] },
      "http",
    );
    await env.DB.prepare("UPDATE selections SET updated_at=? WHERE model_id=?")
      .bind(new Date(Date.now() - 31 * 60_000).toISOString(), m.id)
      .run();
    expect(await modelContext(carol, m.id)).not.toContain("Selected:");
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
    await dispatch(
      viewer,
      "selection_set",
      { modelId: m.id, refs: [coin] },
      "http",
    );
    expect(await modelContext(carol, m.id)).not.toContain("Selected:");
    await expect(
      dispatch(
        carol,
        "selection_set",
        { modelId: m.id, refs: [base, base, base, base, base] },
        "http",
      ),
    ).rejects.toThrow();
    await expect(
      dispatch(
        carol,
        "selection_set",
        { modelId: m.id, refs: [{ ref: "face", of: "Base" }] },
        "http",
      ),
    ).rejects.toThrow("not a reference");
  });
});
