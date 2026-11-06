import { describe, expect, it } from "vitest";
import raw from "../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import type { InspectRecord } from "./inspect";
import { ghostShape } from "./ghost";

const record = raw as unknown as InspectRecord;
// The fixture's Base is 100 × 40 × 10 standing on z = 0; tag its top and bottom as named sides.
const withSides: InspectRecord = {
  ...record,
  faces: record.faces.map((f) =>
    f.part === 0 && f.plane?.normal[2] === 1 && f.center[2] === 10
      ? { ...f, sides: ["top"] }
      : f.part === 0 && f.plane?.normal[2] === -1
        ? { ...f, sides: ["bottom"] }
        : f,
  ),
};
const top = { ref: "face", of: "Base", name: "top" };
const bottom = { ref: "face", of: "Base", name: "bottom" };

describe("ghostShape", () => {
  it("drills a hole into the face, by depth or through the part", () => {
    expect(
      ghostShape(
        "hole",
        { on: bottom, at: [30, 0, 0], diameter: 5, depth: 6 },
        withSides,
        {},
      ),
    ).toEqual({
      kind: "cylinder",
      origin: [30, 0, 0],
      axis: [0, 0, 1],
      radius: 2.5,
      length: 6,
    });
    const through = ghostShape(
      "hole",
      {
        on: bottom,
        at: [30, 0, 0],
        diameter: { param: "HOLE_D" },
        extent: "through",
      },
      withSides,
      {
        HOLE_D: 4,
      },
    );
    expect(through).toMatchObject({ kind: "cylinder", radius: 2, length: 10 });
  });
  it("offsets a plane along the face normal", () => {
    expect(
      ghostShape(
        "plane",
        { method: "offset", reference: top, distance: 5 },
        withSides,
        {},
      ),
    ).toMatchObject({
      kind: "plane",
      origin: [expect.closeTo(0, 6), expect.closeTo(0, 6), 15],
      normal: [0, 0, 1],
    });
  });
  it("stands a body on a face and extrudes into or out of it", () => {
    expect(
      ghostShape(
        "body",
        { shape: "box", size: [20, 10, 30], on: top },
        withSides,
        {},
      ),
    ).toMatchObject({
      kind: "prism",
      normal: [0, 0, 1],
      width: 20,
      length: 10,
      depth: 30,
    });
    expect(
      ghostShape(
        "extrude",
        {
          on: top,
          profile: "rectangle",
          width: 8,
          length: 4,
          distance: -2,
          operation: "cut",
        },
        withSides,
        {},
      ),
    ).toMatchObject({
      kind: "prism",
      normal: [0, 0, -1],
      width: 8,
      length: 4,
      depth: 2,
    });
  });
  it("draws nothing until the face is known", () => {
    expect(ghostShape("hole", { diameter: 5 }, withSides, {})).toBeNull();
    expect(ghostShape("fillet", { radius: 1 }, withSides, {})).toBeNull();
  });
});
