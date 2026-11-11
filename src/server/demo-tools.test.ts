import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { execute } from "./tools";
import { member } from "./test-helpers";
import { emptyPhaseState } from "../shared/phases";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const script = (title = "Demo") => ({
  version: 1,
  title,
  summary: "A recorded walkthrough",
  steps: [
    {
      phase: "brief",
      kind: "agent",
      model: "claude-opus-5.5",
      title: "Mantel fills in the brief",
      caption: "From one message",
      prompt: "We need a deal toy",
      response: "Done",
      actions: [
        { name: "brief_update", ok: true, detail: "Brief answers saved" },
      ],
      revision: 0,
      state: emptyPhaseState(),
    },
  ],
});

it("saves a demo for its owner and plays it to anyone who may view the project", async () => {
  const owner = await member("demo-owner@test.example");
  const project = (await execute(owner, "projects_create", {
    name: "Recorded",
    brief: "",
  })) as { id: string };
  expect(await execute(owner, "demo_get", { projectId: project.id })).toEqual({
    script: null,
  });
  expect(
    await execute(owner, "demo_save", {
      projectId: project.id,
      script: script(),
    }),
  ).toEqual({ steps: 1 });
  await execute(owner, "demo_save", {
    projectId: project.id,
    script: script("Second take"),
  });
  const read = (await execute(owner, "demo_get", {
    projectId: project.id,
  })) as {
    script: { title: string; steps: unknown[] };
  };
  expect(read.script.title).toBe("Second take");
  const list = (await execute(owner, "projects_list", {})) as {
    own: { id: string; has_demo: number }[];
  };
  expect(list.own.find((p) => p.id === project.id)?.has_demo).toBe(1);

  // Someone else can neither read a private project's demo nor overwrite it.
  const other = await member("demo-other@test.example");
  await expect(
    execute(other, "demo_get", { projectId: project.id }),
  ).rejects.toThrow(/not found/i);
  await expect(
    execute(other, "demo_save", { projectId: project.id, script: script() }),
  ).rejects.toThrow(/not found/i);
});

it("hides who approved each step from demo viewers, as phases_get does", async () => {
  const owner = await member("demo-people@test.example");
  const project = (await execute(owner, "projects_create", {
    name: "People",
    brief: "",
  })) as { id: string };
  const approved = script();
  const state = approved.steps[0].state as ReturnType<typeof emptyPhaseState>;
  state.brief.approved = {
    by: "demo-people@test.example",
    at: "2026-05-04T15:10:00.000Z",
    version: 1,
    fields: [],
  };
  await execute(owner, "demo_save", {
    projectId: project.id,
    script: approved,
  });
  await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
    .bind(project.id)
    .run();
  const viewer = await member("demo-viewer@test.example", { level: "Demo" });
  type Read = {
    script: {
      steps: { state: { brief: { approved: { by: string } } } }[];
    };
  };
  const seen = (await execute(viewer, "demo_get", {
    projectId: project.id,
  })) as Read;
  expect(seen.script.steps[0].state.brief.approved.by).toBe("");
  const own = (await execute(owner, "demo_get", {
    projectId: project.id,
  })) as Read;
  expect(own.script.steps[0].state.brief.approved.by).toBe(
    "demo-people@test.example",
  );
});

it("refuses malformed scripts", async () => {
  const owner = await member("demo-shape@test.example");
  const project = (await execute(owner, "projects_create", {
    name: "Shapes",
    brief: "",
  })) as { id: string };
  const bad = script();
  (bad.steps[0] as Record<string, unknown>).phase = "launch";
  await expect(
    execute(owner, "demo_save", { projectId: project.id, script: bad }),
  ).rejects.toThrow();
  await expect(
    execute(owner, "demo_save", {
      projectId: project.id,
      script: { ...script(), steps: [] },
    }),
  ).rejects.toThrow();
});
