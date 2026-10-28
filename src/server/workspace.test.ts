import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { execute } from "./tools";
import { consume } from "./builds";
import { hash, type Context } from "./core";
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
const alice: Context = {
  env,
  identity: { email: "alice@example.test", role: "admin" },
};
const bob: Context = {
  env,
  identity: { email: "bob@example.test", role: "maker" },
};
const token = "test-token-with-at-least-thirty-two-characters";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare(
    "INSERT INTO members VALUES ('alice@example.test','admin',1),('bob@example.test','maker',1)",
  ).run();
  await env.DB.prepare("INSERT INTO tokens VALUES (?,?,?,?)")
    .bind(
      await hash(token),
      alice.identity.email,
      "test",
      "2099-01-01T00:00:00.000Z",
    )
    .run();
});
async function project(c = alice) {
  return (await execute(c, "projects_create", {
    name: "Bridge study",
    brief: "Synthetic brief",
  })) as { id: string };
}
async function model() {
  const p = await project();
  const m = (await execute(alice, "models_create", {
    projectId: p.id,
    name: "Bridge",
  })) as { id: string };
  return { p, m };
}
describe("Workspace authorization and revisions", () => {
  it("rejects anonymous API and MCP requests", async () => {
    for (const path of ["/api/session", "/mcp"])
      expect(
        (await exports.default.fetch(`https://example.test${path}`)).status,
      ).toBe(401);
  });
  it("accepts valid token and rejects forged Access email", async () => {
    expect(
      (
        await exports.default.fetch("https://example.test/api/session", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await exports.default.fetch("https://example.test/api/session", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "alice@example.test",
          },
        })
      ).status,
    ).toBe(401);
  });
  it("prevents reading another owner project", async () => {
    const p = await project();
    await expect(
      execute(bob, "projects_get", { projectId: p.id }),
    ).rejects.toThrow("Project not found");
  });
  it("saves immutable revisions and rejects stale writes", async () => {
    const { m } = await model();
    const source = "import build123d as bd\ndef build(): return bd.Box(1,2,3)";
    await execute(alice, "models_save", {
      modelId: m.id,
      expectedRevision: 0,
      source,
    });
    await expect(
      execute(alice, "models_save", {
        modelId: m.id,
        expectedRevision: 0,
        source: "overwrite",
      }),
    ).rejects.toThrow("Model changed");
    const rows = await env.DB.prepare(
      "SELECT * FROM revisions WHERE model_id=?",
    )
      .bind(m.id)
      .all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].source).toBe(source);
  });
  it("allows only one winner for concurrent updates", async () => {
    const { m } = await model();
    const results = await Promise.allSettled(
      [1, 2].map((n) =>
        execute(alice, "models_save", {
          modelId: m.id,
          expectedRevision: 0,
          source: `# ${n}`,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("prevents cross-project revision links", async () => {
    const { m } = await model();
    const other = await project();
    const revision = (await execute(alice, "models_save", {
      modelId: m.id,
      expectedRevision: 0,
      source: "# source",
    })) as { id: string };
    const foreign = (await execute(bob, "projects_create", {
      name: "Bob",
    })) as { id: string };
    await expect(
      execute(bob, "documents_add", {
        projectId: foreign.id,
        revisionId: revision.id,
        kind: "bom",
        title: "BOM",
        content: "draft",
      }),
    ).rejects.toThrow("Revision not found");
    await expect(
      execute(alice, "documents_add", {
        projectId: other.id,
        revisionId: revision.id,
        kind: "bom",
        title: "BOM",
        content: "draft",
      }),
    ).rejects.toThrow("another project");
  });
  it("preserves manufacturing brief versions", async () => {
    const p = await project();
    for (const content of ["first", "second"])
      await execute(alice, "documents_add", {
        projectId: p.id,
        kind: "manufacturing-brief",
        title: "Brief",
        content,
      });
    const { results } = await env.DB.prepare(
      "SELECT version,content FROM documents WHERE project_id=? ORDER BY version",
    )
      .bind(p.id)
      .all();
    expect(results).toEqual([
      { version: 1, content: "first" },
      { version: 2, content: "second" },
    ]);
  });
  it("blocks member tool administration and checks disabled tools at call time", async () => {
    await expect(
      execute(bob, "tools_configure", { name: "skills_save", enabled: false }),
    ).rejects.toThrow("Administrator");
    await execute(alice, "tools_configure", {
      name: "skills_save",
      enabled: false,
    });
    await expect(execute(alice, "skills_save", {})).rejects.toThrow("disabled");
    await execute(alice, "tools_configure", {
      name: "skills_save",
      enabled: true,
    });
  });
  it("rejects cross-origin mutations", async () => {
    expect(
      (
        await exports.default.fetch(
          "https://example.test/api/tools/projects_create",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Origin: "https://attacker.test",
              "Content-Type": "application/json",
            },
            body: '{"name":"x"}',
          },
        )
      ).status,
    ).toBe(403);
  });
  it("serves MCP initialize and registered tools over HTTP", async () => {
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
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("deal-toy");
  });
  it("rejects expired tokens", async () => {
    const expired = "expired-test-token-with-thirty-two-characters";
    await env.DB.prepare("INSERT INTO tokens VALUES (?,?,?,?)")
      .bind(
        await hash(expired),
        alice.identity.email,
        "expired",
        "2020-01-01T00:00:00.000Z",
      )
      .run();
    expect(
      (
        await exports.default.fetch("https://example.test/api/session", {
          headers: { Authorization: `Bearer ${expired}` },
        })
      ).status,
    ).toBe(401);
  });
});

describe("Build lifecycle", () => {
  async function queuedJob() {
    const { m } = await model();
    const revision = (await execute(alice, "models_save", {
      modelId: m.id,
      expectedRevision: 0,
      source: "# fixture",
    })) as { id: string };
    const jobId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO jobs VALUES (?,?,'queued',NULL,NULL,?,?)")
      .bind(
        jobId,
        revision.id,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    return {
      jobId,
      message: {
        body: { jobId },
        ack: vi.fn(),
        retry: vi.fn(),
      } as unknown as Message<unknown>,
    };
  }
  it("persists exports once and refuses another owner's download", async () => {
    const { jobId, message } = await queuedJob();
    const facts = {
      units: "mm",
      bounds: [1, 2, 3],
      volume_mm3: 6,
      solids: 1,
      valid: true,
      manufacturing_approval: "not_reviewed",
    };
    const artifacts = [
      "model.step",
      "model.stl",
      "model.glb",
      "facts.json",
    ].map((name) => ({
      name,
      mediaType: "ignored",
      base64: btoa(
        name === "facts.json" ? JSON.stringify(facts) : "synthetic-test-bytes",
      ),
    }));
    const container = {
      fetch: vi.fn(async () => Response.json({ artifacts })),
      destroy: vi.fn(async () => {}),
    };
    const testEnv = {
      DB: env.DB,
      ARTIFACTS: env.ARTIFACTS,
      CAD: { getByName: () => container },
    } as unknown as Env;
    await consume(message, testEnv);
    await consume(message, testEnv);
    expect(container.fetch).toHaveBeenCalledTimes(1);
    expect(container.destroy).toHaveBeenCalledTimes(1);
    const result = (await execute(alice, "builds_get", { jobId })) as {
      status: string;
      artifacts: { id: string }[];
    };
    expect(result.status).toBe("succeeded");
    expect(result.artifacts).toHaveLength(4);
    await expect(execute(bob, "builds_get", { jobId })).rejects.toThrow(
      "Revision not found",
    );
    expect(
      await env.ARTIFACTS.get(`builds/${jobId}/facts.json`),
    ).not.toBeNull();
    expect(
      (
        await exports.default.fetch(
          `https://example.test/api/artifacts/${result.artifacts[0].id}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
      ).status,
    ).toBe(200);
  });
  it("removes partial exports when runtime output is invalid", async () => {
    const { jobId, message } = await queuedJob();
    const artifacts = [
      "model.step",
      "model.stl",
      "model.glb",
      "facts.json",
    ].map((name) => ({
      name,
      mediaType: "ignored",
      base64: btoa(name === "facts.json" ? "{}" : "test"),
    }));
    const container = {
      fetch: vi.fn(async () => Response.json({ artifacts })),
      destroy: vi.fn(async () => {}),
    };
    await consume(message, {
      DB: env.DB,
      ARTIFACTS: env.ARTIFACTS,
      CAD: { getByName: () => container },
    } as unknown as Env);
    const result = (await execute(alice, "builds_get", { jobId })) as {
      status: string;
      artifacts: unknown[];
    };
    expect(result.status).toBe("failed");
    expect(result.artifacts).toEqual([]);
    expect(await env.ARTIFACTS.get(`builds/${jobId}/model.step`)).toBeNull();
    expect(container.destroy).toHaveBeenCalledTimes(1);
  });
});
