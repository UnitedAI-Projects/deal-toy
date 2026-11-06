import { describe, expect, it } from "vitest";
import { actions, getAction } from "./catalog";
import { readSteps } from "./script";
import { unsupportedKeywords, validateInputs } from "./validate";

const hole = getAction("hole");
const base = {
  on: { ref: "face", of: "Base", name: "bottom" },
  diameter: 5,
  extent: "through",
};

describe("validateInputs", () => {
  it("accepts the catalog examples", () => {
    for (const action of actions) {
      const source = `def build():\n    # mantel:steps begin\n    ${action.example}\n    # mantel:steps end\n`;
      const [step] = readSteps(source).steps;
      expect(step.action).toBe(action.id);
      if (action.id === "custom") continue; // its function is defined by the script
      expect(
        () => validateInputs(action, step.inputs),
        action.id,
      ).not.toThrow();
    }
  });
  it("rejects out-of-range numbers", () => {
    expect(() => validateInputs(hole, { ...base, diameter: 500 })).toThrow(
      "diameter must be at most 200 mm",
    );
  });
  it("rejects unknown keys", () => {
    expect(() => validateInputs(hole, { ...base, colour: "red" })).toThrow(
      "colour is not an input of hole",
    );
  });
  it("checks variant requirements", () => {
    expect(() =>
      validateInputs(hole, { ...base, kind: "counterbore", cb_diameter: 9 }),
    ).toThrow("cb_depth is required when kind is counterbore");
    expect(() => validateInputs(hole, { on: base.on, diameter: 5 })).toThrow(
      "depth is required when extent is distance",
    );
  });
  it("checks enums, types and array sizes", () => {
    expect(() => validateInputs(hole, { ...base, kind: "spiral" })).toThrow(
      "kind must be one of simple, counterbore, countersink",
    );
    expect(() => validateInputs(hole, { ...base, diameter: "5" })).toThrow(
      "diameter must be a number",
    );
    expect(() => validateInputs(hole, { ...base, at: [1, 2] })).toThrow(
      "at must have 3 items",
    );
    expect(() => validateInputs(hole, { ...base, at: [1, 2, 9000] })).toThrow(
      "at[2] must be at most 2000 mm",
    );
  });
  it("accepts param refs for numbers", () => {
    expect(
      validateInputs(hole, {
        ...base,
        diameter: { param: "HOLE_D" },
        at: [{ param: "X" }, 0, 0],
      }),
    ).toMatchObject({ diameter: { param: "HOLE_D" } });
    expect(() =>
      validateInputs(hole, { ...base, diameter: { param: "bad name" } }),
    ).toThrow("diameter must be a number");
  });
  it("checks ref kinds", () => {
    expect(() =>
      validateInputs(hole, { ...base, on: { ref: "part", label: "Base" } }),
    ).toThrow("on must be a face reference");
    expect(() =>
      validateInputs(getAction("body"), {
        shape: "box",
        size: [1, 1, 1],
        on: { ref: "datum", name: "Mid" },
      }),
    ).not.toThrow();
    expect(() =>
      validateInputs(hole, { ...base, on: { ref: "face", of: "Base" } }),
    ).toThrow("on must be a face reference");
  });
  it("lets custom steps take any further inputs", () => {
    expect(
      validateInputs(getAction("custom"), { fn: { fn: "notch" }, depth: 2 }),
    ).toEqual({ fn: { fn: "notch" }, depth: 2 });
    expect(() => validateInputs(getAction("custom"), { depth: 2 })).toThrow(
      "fn is required",
    );
  });
  it("uses only the supported schema keywords in the catalog", () => {
    for (const action of actions)
      expect(unsupportedKeywords(action.inputs), action.id).toEqual([]);
    expect(unsupportedKeywords({ type: "string", pattern: "x" })).toEqual([
      "pattern",
    ]);
  });
});
