import { describe, expect, it } from "vitest";
import type {
  FaceRecord,
  HoleRecord,
  InspectRecord,
} from "../shared/inspect-types";
import { drawingDetails } from "./drawing-spec";

function face(
  index: number,
  min: FaceRecord["bbox"]["min"],
  max: FaceRecord["bbox"]["max"],
  names?: FaceRecord["names"],
): FaceRecord {
  return {
    index,
    part: 1,
    type: "cylinder",
    area: 1,
    center: [0, 0, 0],
    bbox: { min, max },
    names,
  };
}

function hole(
  faces: number[],
  diameter: number,
  direction: HoleRecord["axis"]["direction"],
  through = true,
): HoleRecord {
  return {
    part: 1,
    faces,
    diameter,
    axis: { origin: [25, 0, 18], direction },
    depth: 10,
    through,
  };
}

function record(overrides: Partial<InspectRecord>): InspectRecord {
  return {
    version: 1,
    units: "mm",
    warnings: [],
    parts: [
      {
        index: 1,
        label: "Body",
        volume: 1,
        area: 1,
        bbox: { min: [0, 0, 0], max: [1, 1, 1] },
        center_of_mass: [0, 0, 0],
      },
    ],
    faces: [],
    holes: [],
    faces_truncated: false,
    ...overrides,
  };
}

describe("drawingDetails", () => {
  it("lists materials and flags a dimension that left its parameter", () => {
    const details = drawingDetails(
      record({
        materials: { Body: { name: "C360 brass", density_g_cm3: 8.5 } },
        dimensions: [
          {
            name: "Body width",
            value: 76,
            faces: [1, 2],
            matches_param: false,
            scale: 1,
          },
        ],
      }),
    );
    expect(details.materials).toEqual([{ part: "Body", name: "C360 brass" }]);
    expect(details.dimensions).toEqual([
      { name: "Body width", value: 76, matches: false },
    ]);
  });

  it("keeps bores and drops rounded inside corners", () => {
    const details = drawingDetails(
      record({
        faces: [
          face(1, [23.35, -1.65, 18], [26.65, 1.65, 28]),
          face(2, [-15.67, -7, 90], [-12.67, 7, 93]),
        ],
        holes: [hole([1], 3.3, [0, 0, 1], false), hole([2], 6, [0, -1, 0])],
      }),
    );
    expect(details.holes).toEqual([
      { part: "Body", diameter: 3.3, depth: 10, blind: true, at: [25, 0, 18] },
    ]);
  });

  it("keeps a hole it cannot judge", () => {
    const details = drawingDetails(record({ holes: [hole([99], 4, [0, 0, 1])] }));
    expect(details.holes).toHaveLength(1);
  });

  it("measures each text step across its faces", () => {
    const named = [{ of: "Text line 1", name: "text_faces" }];
    const details = drawingDetails(
      record({
        faces: [
          face(1, [-18, -7, 60], [0, -6.7, 66], named),
          face(2, [0, -7, 61], [18, -6.7, 67], named),
          face(3, [0, 0, 0], [1, 1, 1], [{ of: "Pocket", name: "sides" }]),
        ],
      }),
    );
    expect(details.text).toEqual([
      {
        name: "Text line 1",
        bbox: { min: [-18, -7, 60], max: [18, -6.7, 67] },
      },
    ]);
  });

  it("states no text extent from a truncated record", () => {
    const named = [{ of: "Text line 1", name: "text_faces" }];
    const details = drawingDetails(
      record({
        faces: [face(1, [0, 0, 0], [1, 1, 1], named)],
        faces_truncated: true,
      }),
    );
    expect(details.text).toEqual([]);
  });
});
