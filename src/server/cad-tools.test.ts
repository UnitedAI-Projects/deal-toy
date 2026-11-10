import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dispatch, execute } from "./tools";
import { agentTurn } from "./agent";
import { cookieFor, member } from "./test-helpers";
import { finish } from "./test-builds";
import type { Context } from "./core";
import {
  commandProblem,
  designOf,
  setDesignParameter,
} from "../shared/cad-source";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const design = (params: Record<string, string> = { width: "60 mm" }) =>
  JSON.stringify({
    format: "solidcraft/52",
    name: "bracket",
    units: "mm",
    params: [
      ...Object.entries(params).map(([name, expr]) => ({
        name,
        expr,
        unit: "mm",
        model: false,
      })),
      { name: "d1", expr: "width", unit: "mm", model: true },
    ],
    features: [
      { id: 1, type: "sketch", name: "Profile" },
      { id: 2, type: "extrude", name: "Extrude1" },
    ],
  });

let counter = 0;
/** A member with a project, and a CAD container that applies edits by recording them. */
async function setup(reply?: (body: Record<string, unknown>) => Response) {
  const base = await member(`cad${++counter}@test.example`);
  const edits: Record<string, unknown>[] = [];
  const container = {
    fetch: vi.fn(async (request: Request) => {
      const body = (await request.json()) as Record<string, unknown>;
      edits.push({ path: new URL(request.url).pathname, ...body });
      return (
        reply?.(body) ??
        Response.json({
          design: design({ width: "80 mm" }),
          results: [{ ok: true }],
        })
      );
    }),
    destroy: vi.fn(async () => {}),
  };
  const c: Context = {
    ...base,
    env: { ...env, CAD: { getByName: () => container } } as unknown as Env,
  };
  const project = (await execute(c, "projects_create", {
    name: "MantelCAD model",
    brief: "",
  })) as { id: string };
  return { c, project: project.id, edits, container };
}

describe("MantelCAD sources", () => {
  it("recognizes designs and nothing else", () => {
    expect(designOf(design())?.name).toBe("bracket");
    expect(designOf("def build():\n    return box")).toBeNull();
    expect(designOf('{"format":"other/1"}')).toBeNull();
    expect(designOf('{"format":"solidcraft/52"')).toBeNull();
  });

  it("sets only a named literal parameter", () => {
    const next = setDesignParameter(design(), "width", 75);
    expect(designOf(next)?.params?.[0].expr).toBe("75 mm");
    expect(() => setDesignParameter(design(), "d1", 3)).toThrow(/no parameter/);
    expect(() =>
      setDesignParameter(design({ width: "base * 2" }), "width", 3),
    ).toThrow(/expression/);
  });

  it("refuses commands outside modelling", () => {
    expect(commandProblem("solid.extrude")).toBeNull();
    expect(commandProblem("file.save")).toMatch(/not a modelling command/);
    expect(commandProblem("sketch.insert_svg")).toMatch(/other files/);
    expect(commandProblem("Solid.Extrude")).toMatch(/not a MantelCAD command/);
  });
});

describe("MantelCAD as the model engine", () => {
  it("saves a design as a revision, builds it and serves it back for MantelCAD", async () => {
    const { c } = await setup();
    const project = (await execute(c, "projects_create", {
      name: "Designs",
      brief: "",
    })) as { id: string };
    const model = (await execute(c, "models_create", {
      projectId: project.id,
      name: "Model 01",
    })) as { id: string };
    const saved = (await dispatch(
      c,
      "models_save",
      { modelId: model.id, expectedRevision: 0, source: design() },
      "http",
    ).then((r) => r.value)) as { id: string; number: number };
    expect(saved.number).toBe(1);
    const build = (await execute(c, "models_build", {
      revisionId: saved.id,
    })) as { id: string };
    const calls = await finish(build.id, {
      version: 1,
      units: "mm",
      warnings: [],
      parts: [],
      faces: [],
      holes: [],
      faces_truncated: false,
    });
    expect(calls[0]).toMatchObject({
      path: "/build",
      body: { source: design() },
    });

    const response = await exports.default.fetch(
      new Request(`https://example.test/api/revisions/${saved.id}/design`, {
        headers: { Cookie: await cookieFor(c.identity.email) },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(design());

    // A design has no build123d steps and no view-as-of previews.
    await expect(
      execute(c, "steps_list", { modelId: model.id }),
    ).rejects.toThrow(/MantelCAD design/);
    await expect(
      execute(c, "builds_view_as_of", { revisionId: saved.id, step: "Base" }),
    ).rejects.toThrow(/MantelCAD design/);
  });

  it("keeps Python models within 100 KB and designs within 1 MB", async () => {
    const { c, project } = await setup();
    const model = (await execute(c, "models_create", {
      projectId: project,
      name: "Model 01",
    })) as { id: string };
    await expect(
      execute(c, "models_save", {
        modelId: model.id,
        expectedRevision: 0,
        source: "#".repeat(100_001),
      }),
    ).rejects.toThrow(/100 KB/);
    const big = design().replace(
      '"name":"bracket"',
      `"name":"${"b".repeat(150_000)}"`,
    );
    expect(
      await execute(c, "models_save", {
        modelId: model.id,
        expectedRevision: 0,
        source: big,
      }),
    ).toMatchObject({ number: 1 });
  });

  it("refuses design saves from connected agents", async () => {
    const { c, project } = await setup();
    const model = (await execute(c, "models_create", {
      projectId: project,
      name: "Model 01",
    })) as { id: string };
    await expect(
      dispatch(
        { ...c, channel: "mcp" },
        "models_save",
        { modelId: model.id, expectedRevision: 0, source: design() },
        "mcp",
      ),
    ).rejects.toThrow(/connected agents write build123d Python/);
  });

  it("edits the model with MantelCAD commands, saving a revision and queueing its build", async () => {
    const { c, project, edits, container } = await setup();
    // No model yet: the edit starts a new design and the model is created for it.
    const first = (await dispatch(
      c,
      "models_edit",
      {
        projectId: project,
        commands: [
          { command: "sketch.create", params: { plane: "XY" } },
          { command: "solid.extrude", params: { distance: "5 mm" } },
        ],
      },
      "http",
    ).then((r) => r.value)) as {
      modelId: string;
      revision: number;
      buildId: string;
    };
    expect(first.revision).toBe(1);
    expect(edits[0]).toMatchObject({ path: "/edit", design: null });
    expect(container.destroy).toHaveBeenCalled();
    const job = await env.DB.prepare(
      "SELECT status,purpose FROM jobs WHERE id=?",
    )
      .bind(first.buildId)
      .first();
    expect(job).toEqual({ status: "queued", purpose: "build" });

    const second = (await dispatch(
      c,
      "models_edit",
      {
        projectId: project,
        expectedRevision: 1,
        commands: [
          {
            command: "parameters.change",
            params: { name: "width", expression: "80 mm" },
          },
        ],
      },
      "http",
    ).then((r) => r.value)) as { revision: number };
    expect(second.revision).toBe(2);
    expect(edits[1].design).toBe(design({ width: "80 mm" }));

    const read = (await execute(c, "model_get", { projectId: project })) as {
      engine: string;
      model: { revision: number };
      design: { parameters: unknown[]; features: unknown[] };
    };
    expect(read.engine).toBe("mantelcad");
    expect(read.model.revision).toBe(2);
    expect(read.design.parameters).toEqual([
      { name: "width", expression: "80 mm" },
    ]);
    expect(read.design.features).toHaveLength(2);

    await expect(
      dispatch(
        c,
        "models_edit",
        {
          projectId: project,
          expectedRevision: 1,
          commands: [{ command: "solid.extrude", params: {} }],
        },
        "http",
      ),
    ).rejects.toThrow(/Model changed/);
    await expect(
      dispatch(
        c,
        "models_edit",
        {
          projectId: project,
          commands: [{ command: "file.save", params: {} }],
        },
        "http",
      ),
    ).rejects.toThrow(/not a modelling command/);
  });

  it("reports MantelCAD's error and saves nothing when a command fails", async () => {
    const { c, project } = await setup(() =>
      Response.json(
        {
          error:
            "MantelCAD edit failed: step 1 (solid.fillet): no edge at [999, 0, 0]",
        },
        { status: 400 },
      ),
    );
    await expect(
      dispatch(
        c,
        "models_edit",
        {
          projectId: project,
          commands: [{ command: "solid.fillet", params: { radius: 2 } }],
        },
        "http",
      ),
    ).rejects.toThrow(/solid.fillet/);
    const read = (await execute(c, "model_get", { projectId: project })) as {
      model: { revision: number };
    };
    expect(read.model.revision).toBe(0);
  });

  it("refuses MantelCAD commands on a build123d model", async () => {
    const { c, project } = await setup();
    const model = (await execute(c, "models_create", {
      projectId: project,
      name: "Model 01",
    })) as { id: string };
    await execute(c, "models_save", {
      modelId: model.id,
      expectedRevision: 0,
      source:
        "import build123d as bd\ndef build():\n    return bd.Box(1, 1, 1)\n",
    });
    await expect(
      dispatch(
        c,
        "models_edit",
        {
          projectId: project,
          commands: [{ command: "solid.extrude", params: {} }],
        },
        "http",
      ),
    ).rejects.toThrow(/build123d Python/);
  });

  it("lets the Model phase's agent edit the design it was shown", async () => {
    const { c, project, edits } = await setup();
    const model = (await execute(c, "models_create", {
      projectId: project,
      name: "Model 01",
    })) as { id: string };
    await execute(c, "models_save", {
      modelId: model.id,
      expectedRevision: 0,
      source: design(),
    });
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        tool_calls: [
          {
            name: "model_edit",
            arguments: {
              commands: [
                {
                  command: "parameters.change",
                  params: { name: "width", expression: "80 mm" },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        response: "Width is now 80 mm; the build is queued.",
      });
    const agent: Context = {
      ...c,
      env: {
        ...c.env,
        AI: { run } as unknown as Ai,
        AGENT_DAILY_LIMIT: "20",
        AGENT_GLOBAL_DAILY_LIMIT: "100",
      },
    };
    const turn = await agentTurn(agent, project, {
      id: crypto.randomUUID(),
      phase: "model",
      message: "Make it 80 mm wide",
      model: "llama-3.3-70b",
    });
    expect(turn.status).toBe("complete");
    expect(turn.actions).toEqual([
      {
        name: "model_edit",
        ok: true,
        detail: "Model revision 2 saved; its build is queued",
      },
    ]);
    expect(edits[0].design).toBe(design());
    const [, { messages, tools }] = run.mock.calls[0] as [
      string,
      { messages: { content: string }[]; tools: { name: string }[] },
    ];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["model_edit", "model_set_parameter"]),
    );
    // The request message (the array also holds the tool round that followed).
    const context = JSON.parse(
      messages.find((m) => m.content.includes('"currentModel"'))!.content,
    );
    expect(context.currentModel).toMatchObject({
      engine: "mantelcad",
      model: { id: model.id, revision: 1 },
    });
  });
});
