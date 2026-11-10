import { describe, expect, it } from "vitest";
import { defaultTarget } from "./engine-views";
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
    expect(defaultTarget("model", s, files, step)?.file?.name).toBe(
      "Bridge.sc",
    );
    expect(defaultTarget("model", s, [], step)?.file).toEqual({
      name: "model.step",
      url: "/api/artifacts/s1",
    });
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
});
