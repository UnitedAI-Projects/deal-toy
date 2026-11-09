import { describe, expect, it } from "vitest";
import { actions, getAction } from "./catalog";
import { readSteps } from "./script";
import { unsupportedKeywords, validateInputs } from "./validate";
import { notchRecord } from "./testdata/notch";

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
  it("reads PARAMS inside nested point lists", () => {
    const source =
      'def build():\n    # mantel:steps begin\n    m.revolve("Cup wall", profile=[(0, 0), (40, 0), (40, mt.P("CUP_HEIGHT")), (0, 3)])\n    # mantel:steps end\n';
    const [step] = readSteps(source).steps;
    expect((step.inputs.profile as unknown[])[2]).toEqual([
      40,
      { param: "CUP_HEIGHT" },
    ]);
    expect(() =>
      validateInputs(getAction("revolve"), step.inputs),
    ).not.toThrow();
  });
  it("requires each loft section's sizes", () => {
    expect(() =>
      validateInputs(getAction("loft"), {
        sections: [
          { shape: "circle", z: 0 },
          { shape: "circle", z: 10, diameter: 20 },
        ],
      }),
    ).toThrow("sections[0].diameter is required when shape is circle");
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
  it("needs exactly one of fn and action for a custom step", () => {
    const custom = getAction("custom");
    expect(validateInputs(custom, { fn: { fn: "notch" }, depth: 2 })).toEqual({
      fn: { fn: "notch" },
      depth: 2,
    });
    for (const inputs of [
      { depth: 2 },
      { fn: { fn: "notch" }, action: "finger-notch@1" },
    ])
      expect(() => validateInputs(custom, inputs)).toThrow(
        "A custom step needs exactly one of fn or action",
      );
    expect(() => validateInputs(custom, { action: "Finger Notch" })).toThrow(
      "action must be a saved action as id@version",
    );
  });
  it("validates a saved action's own inputs", () => {
    const custom = getAction("custom");
    const saved = notchRecord();
    const on = { ref: "face", of: "Lid", name: "front" };
    expect(
      validateInputs(
        custom,
        { action: "finger-notch@1", on, width: 18 },
        saved,
      ),
    ).toEqual({
      action: "finger-notch@1",
      on,
      width: 18,
    });
    expect(() =>
      validateInputs(
        custom,
        { action: "finger-notch@1", on, width: 500 },
        saved,
      ),
    ).toThrow("width must be at most 40 mm");
    expect(() =>
      validateInputs(
        custom,
        { action: "finger-notch@1", on, width: 9, colour: "red" },
        saved,
      ),
    ).toThrow("colour is not an input of finger-notch@1");
    expect(() =>
      validateInputs(custom, { action: "finger-notch@2", on, width: 9 }, saved),
    ).toThrow("No saved action finger-notch@2");
  });
  it("uses only the supported schema keywords in the catalog", () => {
    for (const action of actions)
      expect(unsupportedKeywords(action.inputs), action.id).toEqual([]);
    expect(unsupportedKeywords({ type: "string", pattern: "x" })).toEqual([
      "pattern",
    ]);
  });
});
