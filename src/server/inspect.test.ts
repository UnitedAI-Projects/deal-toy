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
