import { describe, expect, it } from "vitest";
import type { FaceRecord, InspectRecord } from "./inspect";
import { refFromPick } from "./refs";

const face = (index: number, extra: Partial<FaceRecord>): FaceRecord =>
  ({
    index,
    part: 0,
    type: "plane",
    area: 1,
    center: [1.23456, 2, 3],
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    plane: { origin: [1.23456, 2, 3], normal: [0, 0, 1] },
    ...extra,
  }) as FaceRecord;
const record = (faces: FaceRecord[]): InspectRecord => ({
  version: 1,
  units: "mm",
  warnings: [],
  parts: [
    {
      index: 0,
      label: "Base",
      volume: 1,
      area: 1,
      bbox: { min: [0, 0, 0], max: [1, 1, 1] },
      center_of_mass: [0, 0, 0],
    },
  ],
  faces,
  holes: [],
  faces_truncated: false,
});

describe("refFromPick", () => {
  it("prefers a created name, the first in step order", () => {
    const r = record([
      face(0, {
        names: [
          { of: "Mount hole", name: "wall" },
          { of: "Split", name: "left" },
        ],
        sides: ["top"],
      }),
    ]);
    expect(refFromPick(r, 0)).toEqual({
      ref: "face",
      of: "Mount hole",
      name: "wall",
    });
  });
  it("uses a part side next", () => {
    expect(refFromPick(record([face(0, { sides: ["bottom"] })]), 0)).toEqual({
      ref: "face",
      of: "Base",
      name: "bottom",
    });
  });
  it("falls back to a normal and nearest-point query", () => {
    expect(refFromPick(record([face(0, {})]), 0)).toEqual({
      ref: "face",
      of: "Base",
      normal: [0, 0, 1],
      near: [1.235, 2, 3],
    });
  });
  it("queries curved faces by their surface normal at the centre's direction", () => {
    const curved = face(0, {
      type: "cylinder",
      plane: undefined,
      cylinder: { origin: [0, 0, 0], axis: [0, 0, 1], radius: 2 },
      center: [2, 0, 5],
    });
    expect(refFromPick(record([curved]), 0)).toEqual({
      ref: "face",
      of: "Base",
      normal: [1, 0, 0],
      near: [2, 0, 5],
    });
  });
});
