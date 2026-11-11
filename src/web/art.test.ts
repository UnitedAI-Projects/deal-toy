import { describe, expect, it } from "vitest";
import { pieces } from "./ArtPhase";
import type { PhaseFile } from "./api";

const f = (id: string, name: string, at: string): PhaseFile => ({
  id,
  phase: "art",
  name,
  media_type: "",
  size: 1,
  url: `/api/phase-files/${id}`,
  created_at: at,
});

describe("art pieces", () => {
  it("groups a source and its exports, newest version of each", () => {
    const list = pieces([
      f("1", "Harbor.vectorcraft", "2026-11-10T10:00:00Z"),
      f("2", "Harbor.svg", "2026-11-10T10:00:01Z"),
      f("3", "Harbor.vectorcraft", "2026-11-10T11:00:00Z"),
      f("4", "Date.svg", "2026-11-10T09:00:00Z"),
    ]);
    expect(list.map((p) => p.name).sort()).toEqual(["Date", "Harbor"]);
    const harbor = list.find((p) => p.name === "Harbor")!;
    expect(harbor.files.map((x) => x.id).sort()).toEqual(["2", "3"]);
    expect(harbor.source?.id).toBe("3");
    expect(harbor.preview?.id).toBe("2");
    expect(harbor.versions).toBe(2);
    const date = list.find((p) => p.name === "Date")!;
    expect(date.source?.id).toBe("4");
  });
});
