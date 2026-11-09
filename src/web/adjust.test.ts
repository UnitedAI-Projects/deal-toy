import { describe, expect, it } from "vitest";
import boxJson from "../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import toyJson from "../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import type { DimensionRecord, InspectRecord } from "../shared/inspect-types";
import { alongAxis, dimensionEdit, dragAxis, dragValue } from "./adjust";

const box = boxJson as unknown as InspectRecord;
const toy = toyJson as unknown as InspectRecord;
const dim = (record: InspectRecord, name: string) =>
  record.dimensions!.find((d) => d.name === name)!;
const params = {
  WALL_T: { value: 2, unit: "mm", min: 1, max: 4 },
  LIP_GAP: { value: 0.3, unit: "mm", min: 0.1, max: 1 },
  ENGRAVE_D: { value: 0.5, unit: "mm", min: 0.2, max: 2 },
};

describe("dimensionEdit", () => {
  it("sets the driving parameter, dividing by the declared scale", () => {
    expect(dimensionEdit(dim(box, "Wall thickness"), params, 2.5)).toEqual({
      name: "WALL_T",
      value: 2.5,
    });
    const diameter: DimensionRecord = {
      ...dim(box, "Wall thickness"),
      scale: 2,
    };
    expect(dimensionEdit(diameter, params, 6)).toEqual({
      name: "WALL_T",
      value: 3,
    });
  });
  it("refuses values outside the parameter's range, naming it", () => {
    expect(dimensionEdit(dim(box, "Wall thickness"), params, 9)).toEqual({
      error: "Wall thickness must be between 1.00 and 4.00 mm",
    });
  });
  it("refuses a declaration that does not match its parameter", () => {
    expect(dimensionEdit(dim(toy, "Engraving depth"), params, 0.6)).toEqual({
      error: "The declaration doesn't match ENGRAVE_D; ask the agent to fix it",
    });
  });
  it("refuses a dimension with no parameter", () => {
    const { param: _, ...free } = dim(box, "Wall thickness");
    expect(dimensionEdit(free as DimensionRecord, params, 3)).toEqual({
      error: "No parameter drives this dimension",
    });
  });
});

describe("dragAxis and dragValue", () => {
  it("moves the declared face along its normal, with the sign that grows the value", () => {
    const wall = dragAxis(box, dim(box, "Wall thickness"))!;
    expect(wall.origin).toEqual(box.faces[7].center);
    expect(wall.direction).toEqual(box.faces[7].plane!.normal);
    expect(wall.sign).toBe(1);
    expect(dragAxis(box, dim(box, "Lip clearance"))!.sign).toBe(-1);
  });
  it("has no handle without a moving face or when the declaration is wrong", () => {
    const { moves: _, ...fixed } = dim(box, "Wall thickness");
    expect(dragAxis(box, fixed as DimensionRecord)).toBeNull();
    expect(dragAxis(toy, dim(toy, "Engraving depth"))).toBeNull();
  });
  it("snaps to 0.1 mm and clamps to the parameter's range", () => {
    const wall = dim(box, "Wall thickness");
    expect(dragValue(wall, params.WALL_T, 0.437, 1)).toBe(2.4);
    expect(dragValue(wall, params.WALL_T, 5, 1)).toBe(4);
    expect(dragValue(wall, params.WALL_T, 5, -1)).toBe(1);
  });
});

describe("alongAxis", () => {
  const origin: [number, number, number] = [0, 0, 0];
  const x: [number, number, number] = [1, 0, 0];
  it("finds where a perpendicular pointer ray passes the axis", () => {
    expect(alongAxis([5, 0, 10], [0, 0, -1], origin, x)).toBeCloseTo(5, 9);
  });
  it("handles an oblique ray", () => {
    expect(alongAxis([3, -10, 2], [0, 1, 0.1], origin, x)).toBeCloseTo(3, 9);
    expect(alongAxis([0, 0, 10], [1, 0, -1], origin, x)).toBeCloseTo(10, 9);
  });
  it("gives 0 for a ray parallel to the axis", () => {
    expect(alongAxis([0, 5, 0], [1, 0, 0], origin, x)).toBe(0);
  });
});
