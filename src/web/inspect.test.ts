import { describe, expect, it } from "vitest";
import raw from "../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import {
  faceSummary,
  measureBetween,
  pickFace,
  surfaceDistance,
  toModel,
  toScene,
  type FaceRecord,
  type InspectRecord,
} from "./inspect";

const record = raw as unknown as InspectRecord;
const face = (
  index: number,
  part: number,
  extra: Partial<FaceRecord>,
): FaceRecord =>
  ({
    index,
    part,
    type: "plane",
    area: 1,
    center: [0, 0, 0],
    bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
    ...extra,
  }) as FaceRecord;
// A 20 × 20 × 10 plate with a through hole of radius 2 on the Z axis.
const plate: InspectRecord = {
  ...record,
  parts: [
    {
      index: 0,
      label: "Plate",
      volume: 1,
      area: 1,
      bbox: { min: [-10, -10, 0], max: [10, 10, 10] },
      center_of_mass: [0, 0, 5],
    },
  ],
  faces: [
    face(0, 0, {
      center: [0, 0, 10],
      bbox: { min: [-10, -10, 10], max: [10, 10, 10] },
      plane: { origin: [0, 0, 10], normal: [0, 0, 1] },
    }),
    face(1, 0, {
      center: [10, 0, 5],
      bbox: { min: [10, -10, 0], max: [10, 10, 10] },
      plane: { origin: [10, 0, 5], normal: [1, 0, 0] },
    }),
    face(2, 0, {
      type: "cylinder",
      center: [0, 0, 5],
      bbox: { min: [-2, -2, 0], max: [2, 2, 10] },
      cylinder: { origin: [0, 0, 0], axis: [0, 0, 1], radius: 2 },
    }),
  ],
  holes: [],
  faces_truncated: false,
};

describe("pickFace", () => {
  it("picks the face under a hit on the fixture", () => {
    const front = pickFace(record, "Block", [0, -15, 100])!;
    expect(record.faces[front].plane?.normal[1]).toBe(-1);
    expect(record.faces[front].part).toBe(1);
    const coin = pickFace(record, "Coin", [10, -13.5, 70])!;
    expect(record.faces[coin].part).toBe(2);
  });
  it("picks a hole wall from inside the hole", () => {
    expect(pickFace(plate, "Plate", [2, 0, 4])).toBe(2);
    expect(pickFace(plate, "Plate", [5, 5, 10])).toBe(0);
  });
  it("breaks ties on an edge by the lower index", () => {
    expect(pickFace(plate, "Plate", [10, 3, 10])).toBe(0);
  });
  it("returns null for an unknown part or a truncated record", () => {
    expect(pickFace(plate, "Nope", [0, 0, 10])).toBeNull();
    expect(
      pickFace(
        { ...plate, faces: [], faces_truncated: true },
        "Plate",
        [0, 0, 10],
      ),
    ).toBeNull();
  });
  it("measures exact distances to surfaces", () => {
    expect(surfaceDistance(plate.faces[0], [3, 3, 12])).toBeCloseTo(2, 9);
    expect(surfaceDistance(plate.faces[2], [5, 0, 3])).toBeCloseTo(3, 9);
  });
});

describe("scene coordinates", () => {
  it("round-trips between model (Z up) and glTF (Y up) space", () => {
    const p: [number, number, number] = [1, 2, 3];
    expect(toScene(p, 1)).toEqual([1, 3, -2]);
    expect(toModel(toScene(p, 0.001), 0.001)).toEqual(
      [1, 2, 3].map((v) => expect.closeTo(v, 9)),
    );
  });
});

describe("faceSummary and measureBetween", () => {
  const withHole: InspectRecord = {
    ...plate,
    holes: [
      {
        part: 0,
        faces: [2],
        diameter: 4,
        axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
        depth: 10,
        through: true,
      },
    ],
    faces: plate.faces.map((f) =>
      f.index === 0 ? { ...f, area: 387.4336, thickness: 10 } : f,
    ),
    pairs: [],
  };
  it("summarises a flat face, a hole wall and a fillet", () => {
    expect(faceSummary(withHole, 0)).toEqual({
      title: "Flat face",
      rows: [
        ["Part", "Plate"],
        ["Area", "387.43 mm²"],
        ["Normal", "(0, 0, 1)"],
        ["Thickness", "10.00 mm"],
      ],
    });
    expect(faceSummary(withHole, 2)).toEqual({
      title: "Hole Ø4.00 mm",
      rows: [
        ["Part", "Plate"],
        ["Area", "1.00 mm²"],
        ["Diameter", "4.00 mm"],
        ["Depth", "10.00 mm, through"],
      ],
    });
    const fillet = { ...withHole, holes: [] };
    expect(faceSummary(fillet, 2).title).toBe("Rounded face R2.00 mm");
  });
  it("measures between parallel faces, parts and coaxial cylinders", () => {
    const block = record.parts.findIndex((p) => p.label === "Block");
    const front = record.faces.find(
      (f) => f.part === block && f.plane?.normal[1] === -1,
    )!;
    const back = record.faces.find(
      (f) => f.part === block && f.plane?.normal[1] === 1,
    )!;
    expect(
      measureBetween(
        record,
        { kind: "face", index: front.index },
        { kind: "face", index: back.index },
      ),
    ).toEqual({ label: "Distance between the faces", value: "30.00 mm" });
    const base = record.parts.findIndex((p) => p.label === "Base");
    expect(
      measureBetween(
        record,
        { kind: "part", index: base },
        { kind: "part", index: block },
      ),
    ).toEqual({
      label: "Gap between Base and Block",
      value: "0.00 mm",
    });
    expect(
      measureBetween(
        withHole,
        { kind: "face", index: 2 },
        { kind: "face", index: 0 },
      ),
    ).toEqual({
      label: "Between these faces",
      unavailable: "Needs an exact measure, which comes with checks",
    });
  });
  it("reports overlap between parts", () => {
    const overlapping: InspectRecord = {
      ...record,
      pairs: [{ a: 0, b: 1, distance: 0, overlap_volume: 100 }],
    };
    expect(
      measureBetween(
        overlapping,
        { kind: "part", index: 1 },
        { kind: "part", index: 0 },
      ),
    ).toEqual({
      label: "Gap between Base and Block",
      value: "0.00 mm, overlapping by 100.00 mm³",
    });
  });
});
