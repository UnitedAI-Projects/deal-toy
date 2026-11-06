import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "../../engine/tests/fixtures/deal_toy.py";
import facts from "../../engine/tests/fixtures/deal_toy.facts.json";
import bridge from "../../examples/bridge.py";
import { consume } from "./builds";
import type { Context } from "./core";
import { execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
let viewer: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-view@example.test", { level: "Maker" });
  viewer = await member("viewer-view@example.test", { level: "Demo" });
});

async function seeded(source = fixture) {
  const p = (await execute(carol, "projects_create", { name: "View" })) as {
    id: string;
  };
  const m = (await execute(carol, "models_create", {
    projectId: p.id,
    name: "Tombstone",
  })) as { id: string };
  const r = (await execute(carol, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source,
  })) as {
    id: string;
  };
  return { p, m, r };
}
const jobs = (revisionId: string) =>
  env.DB.prepare(
    "SELECT id,purpose,options,status FROM jobs WHERE revision_id=?",
  )
    .bind(revisionId)
    .all<{ id: string; purpose: string; options: string; status: string }>()
    .then((r) => r.results);

describe("builds_view_as_of", () => {
  it("queues one view job per revision and step", async () => {
    const { r } = await seeded();
    const first = (await execute(carol, "builds_view_as_of", {
      revisionId: r.id,
      step: "Mount hole",
    })) as {
      id: string;
      status: string;
    };
    expect(first.status).toBe("queued");
    const again = (await execute(carol, "builds_view_as_of", {
      revisionId: r.id,
      step: "Mount hole",
    })) as {
      id: string;
    };
    expect(again.id).toBe(first.id);
    const other = (await execute(carol, "builds_view_as_of", {
      revisionId: r.id,
      step: "Block",
    })) as {
      id: string;
    };
    expect(other.id).not.toBe(first.id);
    const rows = await jobs(r.id);
    expect(rows.map((j) => [j.purpose, JSON.parse(j.options)])).toEqual(
      expect.arrayContaining([
        ["view", { stopAfter: 3 }],
        ["view", { stopAfter: 1 }],
      ]),
    );
  });
  it("refuses unknown steps and free-form scripts", async () => {
    const { r } = await seeded();
    await expect(
      execute(carol, "builds_view_as_of", { revisionId: r.id, step: "Nope" }),
    ).rejects.toThrow('No step named "Nope"');
    const free = await seeded(bridge);
    await expect(
      execute(carol, "builds_view_as_of", {
        revisionId: free.r.id,
        step: "Block",
      }),
    ).rejects.toThrow("no steps section");
    expect(await jobs(r.id)).toHaveLength(0);
    expect(await jobs(free.r.id)).toHaveLength(0);
  });
  it("lets viewers reuse but not queue", async () => {
    const { p, r } = await seeded();
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.id)
      .run();
    await expect(
      execute(viewer, "builds_view_as_of", { revisionId: r.id, step: "Block" }),
    ).rejects.toThrow();
    const queued = (await execute(carol, "builds_view_as_of", {
      revisionId: r.id,
      step: "Block",
    })) as { id: string };
    const reused = (await execute(viewer, "builds_view_as_of", {
      revisionId: r.id,
      step: "Block",
    })) as { id: string };
    expect(reused.id).toBe(queued.id);
  });
  it("consume sends preview options and stores two artifacts", async () => {
    const { r } = await seeded();
    const job = (await execute(carol, "builds_view_as_of", {
      revisionId: r.id,
      step: "Mount hole",
    })) as {
      id: string;
    };
    const viewFacts = {
      ...facts,
      steps: facts.steps.slice(0, 3),
      stoppedAfter: 3,
    };
    const artifacts = ["model.glb", "facts.json"].map((name) => ({
      name,
      mediaType: "ignored",
      base64: btoa(
        name === "facts.json"
          ? unescape(encodeURIComponent(JSON.stringify(viewFacts)))
          : "glb",
      ),
    }));
    const container = {
      fetch: vi.fn(async (_request: Request) => Response.json({ artifacts })),
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
    const body = JSON.parse(await container.fetch.mock.calls[0][0].text());
    expect(body).toMatchObject({ stopAfter: 3, preview: true });
    const result = (await execute(carol, "builds_get", { jobId: job.id })) as {
      status: string;
      artifacts: { name: string }[];
    };
    expect(result.status).toBe("succeeded");
    expect(result.artifacts.map((a) => a.name).sort()).toEqual([
      "facts.json",
      "model.glb",
    ]);
  });
  it("counts toward the build cap", async () => {
    const { r } = await seeded();
    await execute(carol, "builds_view_as_of", {
      revisionId: r.id,
      step: "Block",
    });
    const capped = {
      ...carol,
      env: { ...carol.env, DAILY_BUILD_LIMIT: "1" },
    } as Context;
    await expect(
      execute(capped, "builds_view_as_of", {
        revisionId: r.id,
        step: "Mid plane",
      }),
    ).rejects.toThrow("Daily build limit reached");
  });
});
