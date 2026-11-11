import { describe, expect, it } from "vitest";
import { currentModel, defaultTarget, modelDesign } from "./engine-views";
import { emptyPhaseState } from "./phases";
import type { PhaseFile } from "./api";

const f = (id: string, phase: string, name: string, at: string): PhaseFile => ({
  id,
  phase,
  name,
  media_type: "",
  size: 1,
  url: `/api/phase-files/${id}`,
  created_at: at,
});

describe("engine views", () => {
  it("opens each phase's most recent working file in its engine", () => {
    const s = emptyPhaseState();
    s.brief.files = [
      {
        id: "b1",
        name: "memo.pdf",
        type: "application/pdf",
        size: 1,
        field: "notes",
        url: "/b1",
      },
      {
        id: "b2",
        name: "logo.svg",
        type: "image/svg+xml",
        size: 1,
        field: "logos",
        url: "/b2",
      },
    ];
    s.concepts = [
      {
        id: "c1",
        name: "Old",
        size: "",
        materials: "",
        components: "",
        notes: "",
        mesh: "/m1",
        starred: false,
        discarded: false,
        createdAt: "2026-11-10T01:00:00Z",
      },
      {
        id: "c2",
        name: "New",
        size: "",
        materials: "",
        components: "",
        notes: "",
        mesh: "/m2",
        starred: false,
        discarded: false,
        createdAt: "2026-11-10T02:00:00Z",
      },
    ];
    const files = [
      f("a1", "art", "Logo.vectorcraft", "2026-11-10T01:00:00Z"),
      f("a2", "art", "Logo2.vectorcraft", "2026-11-10T03:00:00Z"),
      f("m1", "model", "Bridge.sc", "2026-11-10T01:00:00Z"),
      f("d1", "documents", "plate-edited.dxf", "2026-11-10T01:00:00Z"),
    ];
    const step = [{ id: "s1", job_id: "j", name: "model.step", size: 1 }];
    expect(defaultTarget("brief", s, files, step)).toMatchObject({
      engine: "mantelpdf",
      file: { name: "memo.pdf", briefField: "notes" },
    });
    expect(defaultTarget("art", s, files, step)?.file?.name).toBe(
      "Logo2.vectorcraft",
    );
    expect(defaultTarget("concepts", s, files, step)).toMatchObject({
      engine: "mantelmesh",
      conceptId: "c2",
      file: { url: "/m2" },
    });
    // The model's design revision; else a legacy model's STEP; else an old loose .sc save.
    const design = { name: "Bracket.sc", url: "/api/revisions/r2/design" };
    expect(defaultTarget("model", s, files, step, design)?.file).toEqual(
      design,
    );
    expect(defaultTarget("model", s, files, step)?.file).toEqual({
      name: "model.step",
      url: "/api/artifacts/s1",
    });
    expect(defaultTarget("model", s, files, [])?.file?.name).toBe("Bridge.sc");
    expect(defaultTarget("documents", s, files, step)?.file?.name).toBe(
      "plate-edited.dxf",
    );
    expect(defaultTarget("manufacture", s, files, step)).toBeNull();
  });

  it("opens an engine with nothing loaded when the phase has no file yet", () => {
    const s = emptyPhaseState();
    expect(defaultTarget("concepts", s, [], [])).toEqual({
      engine: "mantelmesh",
      phase: "concepts",
    });
    expect(defaultTarget("brief", s, [], [])?.file).toBeUndefined();
  });

  it("opens the most revised model's latest revision when it is a MantelCAD design", () => {
    const designJson = JSON.stringify({
      format: "solidcraft/52",
      features: [],
    });
    const data = {
      models: [
        { id: "m1", name: "Old", revision: 1 },
        { id: "m2", name: "Bracket", revision: 2 },
      ],
      revisions: [
        {
          id: "r1",
          model_id: "m2",
          number: 1,
          created_at: "",
          source: "def build(): ...",
        },
        {
          id: "r2",
          model_id: "m2",
          number: 2,
          created_at: "",
          source: designJson,
        },
        {
          id: "r3",
          model_id: "m1",
          number: 1,
          created_at: "",
          source: designJson,
        },
      ],
    };
    expect(currentModel(data)?.revision?.id).toBe("r2");
    expect(modelDesign(data)).toEqual({
      name: "Bracket.sc",
      url: "/api/revisions/r2/design",
    });
    data.revisions[1].source = "def build(): ...";
    expect(modelDesign(data)).toBeUndefined();
    expect(modelDesign({ models: [], revisions: [] })).toBeUndefined();
  });
});
