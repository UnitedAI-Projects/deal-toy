import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "../../engine/tests/fixtures/deal_toy.py";
import { readSteps } from "./actions/script";
import type { Context } from "./core";
import { execute } from "./tools";
import { member } from "./test-helpers";

let carol: Context;
let admin: Context;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  carol = await member("carol-presets@example.test", { level: "Maker" });
  admin = await member("admin-presets@example.test", { level: "Admin" });
});

async function seeded(c = carol) {
  const p = (await execute(c, "projects_create", { name: "Presets" })) as {
    id: string;
  };
  const m = (await execute(c, "models_create", {
    projectId: p.id,
    name: "Base",
  })) as { id: string };
  await execute(c, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source: fixture,
  });
  return { p, m };
}
const m3 = (projectId: string, extra: Record<string, unknown> = {}) => ({
  projectId,
  id: "m3-counterbore",
  expectedVersion: 0,
  action: "hole",
  name: "M3 counterbore",
  description: "Clearance hole for an M3 cap screw, counterbored for the head.",
  inputs: {
    diameter: 3.4,
    kind: "counterbore",
    cb_diameter: 6.5,
    cb_depth: 3.3,
    extent: "through",
  },
  ...extra,
});
const on = { ref: "face", of: "Base", name: "bottom" };
async function lastStep(modelId: string, number: number) {
  const row = await env.DB.prepare(
    "SELECT source FROM revisions WHERE model_id=? AND number=?",
  )
    .bind(modelId, number)
    .first<{ source: string }>();
  return readSteps(row!.source).steps.at(-1)!;
}

describe("presets", () => {
  it("saves, versions and lists presets", async () => {
    const { p } = await seeded();
    expect(await execute(carol, "presets_save", m3(p.id))).toEqual({
      id: "m3-counterbore",
      version: 1,
    });
    await expect(execute(carol, "presets_save", m3(p.id))).rejects.toThrow(
      "Preset changed. Reload first",
    );
    await execute(
      carol,
      "presets_save",
      m3(p.id, { expectedVersion: 1, name: "M3 counterbore (deep)" }),
    );
    const listed = (await execute(carol, "presets_list", {
      projectId: p.id,
      action: "hole",
    })) as {
      id: string;
      version: number;
      name: string;
    }[];
    expect(listed.map((x) => [x.id, x.version, x.name])).toEqual([
      ["m3-counterbore", 2, "M3 counterbore (deep)"],
    ]);
  });
  it("checks each given input", async () => {
    const { p } = await seeded();
    await expect(
      execute(
        carol,
        "presets_save",
        m3(p.id, { id: "bad-a", inputs: { colour: "red" } }),
      ),
    ).rejects.toThrow("colour is not an input of hole");
    await expect(
      execute(
        carol,
        "presets_save",
        m3(p.id, { id: "bad-b", inputs: { diameter: 500 } }),
      ),
    ).rejects.toThrow("diameter must be at most 200 mm");
    await expect(
      execute(
        carol,
        "presets_save",
        m3(p.id, { id: "bad-c", action: "teleport" }),
      ),
    ).rejects.toThrow("Unknown action teleport");
  });
  it("adds a step from a preset, with explicit inputs winning", async () => {
    const { p, m } = await seeded();
    await execute(carol, "presets_save", m3(p.id, { id: "m3-step" }));
    await execute(carol, "steps_add", {
      modelId: m.id,
      expectedRevision: 1,
      action: "hole",
      name: "Screw hole",
      preset: "m3-step",
      inputs: { on, cb_depth: 4 },
    });
    expect((await lastStep(m.id, 2)).inputs).toEqual({
      diameter: 3.4,
      kind: "counterbore",
      cb_diameter: 6.5,
      cb_depth: 4,
      extent: "through",
      on,
    });
  });
  it("names the preset when the merged inputs do not validate", async () => {
    const { p, m } = await seeded();
    await execute(
      carol,
      "presets_save",
      m3(p.id, {
        id: "m3-partial",
        inputs: { kind: "counterbore", cb_diameter: 6.5 },
      }),
    );
    await expect(
      execute(carol, "steps_add", {
        modelId: m.id,
        expectedRevision: 1,
        action: "hole",
        name: "Screw hole",
        preset: "m3-partial",
        inputs: { on, diameter: 3.4, extent: "through" },
      }),
    ).rejects.toThrow(
      "Preset m3-partial: cb_depth is required when kind is counterbore",
    );
    await expect(
      execute(carol, "steps_add", {
        modelId: m.id,
        expectedRevision: 1,
        action: "fillet",
        name: "Round",
        preset: "m3-partial",
        inputs: {},
      }),
    ).rejects.toThrow("Preset m3-partial is for hole, not fillet");
  });
  it("follows scope", async () => {
    const mine = await seeded();
    const theirs = await seeded();
    await execute(
      carol,
      "presets_save",
      m3(theirs.p.id, { id: "their-preset" }),
    );
    expect(
      (
        (await execute(carol, "presets_list", { projectId: mine.p.id })) as {
          id: string;
        }[]
      ).map((x) => x.id),
    ).not.toContain("their-preset");
    await expect(
      execute(
        carol,
        "presets_save",
        m3(mine.p.id, { id: "team-preset", scope: "team" }),
      ),
    ).rejects.toThrow("Configure skills and tools");
    const shared = await seeded(admin);
    await execute(
      admin,
      "presets_save",
      m3(shared.p.id, { id: "team-preset", scope: "team" }),
    );
    expect(
      (
        (await execute(carol, "presets_list", { projectId: mine.p.id })) as {
          id: string;
        }[]
      ).map((x) => x.id),
    ).toContain("team-preset");
  });
});
