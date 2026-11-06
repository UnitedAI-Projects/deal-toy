import { describe, expect, it } from "vitest";
import fixture from "../../../engine/tests/fixtures/deal_toy.py";
import { applyStepChange, describeChange } from "./ops";
import { readSteps, type Step } from "./script";

const steps = readSteps(fixture).steps;
const labels = ["Base", "Coin", "Block"];
const names = (list: Step[]) => list.map((s) => s.name);
const hole = {
  action: "hole",
  name: "Hole 3",
  inputs: {
    on: { ref: "face", of: "Base", name: "bottom" },
    diameter: 4,
    extent: "through",
  },
} as const;

describe("applyStepChange", () => {
  it("appends, or adds after a named step", () => {
    expect(
      names(applyStepChange(steps, { op: "add", step: hole }, labels)).at(-1),
    ).toBe("Hole 3");
    const after = applyStepChange(
      steps,
      { op: "add", step: hole, after: "Mid plane" },
      labels,
    );
    expect(names(after).slice(0, 3)).toEqual(["Block", "Mid plane", "Hole 3"]);
    expect(after[2].suppressed).toBe(false);
    expect(steps).toHaveLength(7);
  });
  it("refuses duplicate names", () => {
    expect(() =>
      applyStepChange(
        steps,
        { op: "add", step: { ...hole, name: "Block edges" } },
        labels,
      ),
    ).toThrow('A step or part is already named "Block edges"');
    expect(() =>
      applyStepChange(
        steps,
        { op: "add", step: { ...hole, name: "Coin" } },
        labels,
      ),
    ).toThrow('A step or part is already named "Coin"');
    expect(() =>
      applyStepChange(
        steps,
        { op: "rename", name: "Mid plane", newName: "Base" },
        labels,
      ),
    ).toThrow('A step or part is already named "Base"');
  });
  it("refuses invalid names", () => {
    for (const bad of [
      "",
      'Say "hi"',
      "back\\slash",
      "two\nlines",
      "x".repeat(81),
    ])
      expect(() =>
        applyStepChange(
          steps,
          { op: "add", step: { ...hole, name: bad } },
          labels,
        ),
      ).toThrow("Step names are 1 to 80 characters");
  });
  it("edit replaces inputs and keeps position", () => {
    const edited = applyStepChange(
      steps,
      {
        op: "edit",
        name: "Mount hole",
        inputs: { ...steps[2].inputs, diameter: 6 },
      },
      labels,
    );
    expect(names(edited)).toEqual(names(steps));
    expect(edited[2].inputs.diameter).toBe(6);
    expect(steps[2].inputs.diameter).toEqual({ param: "HOLE_D" });
  });
  it("rename rewrites later references", () => {
    const renamed = applyStepChange(
      steps,
      { op: "rename", name: "Block", newName: "Tower" },
      labels,
    );
    expect(renamed[0].name).toBe("Tower");
    expect(renamed[1].inputs.between).toEqual([
      { ref: "face", of: "Tower", name: "left" },
      { ref: "face", of: "Tower", name: "right" },
    ]);
    expect(renamed[5].inputs.target).toEqual({ ref: "part", label: "Tower" });
    expect(renamed[6].inputs.edges).toEqual({
      ref: "edges",
      of: "Tower",
      around: "top",
    });
    const plane = applyStepChange(
      [
        ...steps,
        {
          action: "plane",
          name: "P",
          inputs: {
            method: "offset",
            reference: { ref: "datum", name: "Mid plane" },
            distance: 1,
          },
          suppressed: false,
        },
      ],
      { op: "rename", name: "Mid plane", newName: "Centre" },
      labels,
    );
    expect(plane[7].inputs.reference).toEqual({ ref: "datum", name: "Centre" });
  });
  it("rename leaves earlier steps alone", () => {
    const moved = applyStepChange(
      steps,
      { op: "move", name: "Block", after: "Block edges" },
      labels,
    );
    const renamed = applyStepChange(
      moved,
      { op: "rename", name: "Block", newName: "Tower" },
      labels,
    );
    expect(renamed[0].inputs.between).toEqual(steps[1].inputs.between);
  });
  it("remove leaves references for the build to block", () => {
    const removed = applyStepChange(
      steps,
      { op: "remove", name: "Block" },
      labels,
    );
    expect(names(removed)).not.toContain("Block");
    expect(removed[0].inputs.between).toEqual(steps[1].inputs.between);
  });
  it("moves to first or after a step", () => {
    expect(
      names(
        applyStepChange(
          steps,
          { op: "move", name: "Deal text", after: null },
          labels,
        ),
      )[0],
    ).toBe("Deal text");
    const after = applyStepChange(
      steps,
      { op: "move", name: "Block", after: "Mount hole" },
      labels,
    );
    expect(names(after).slice(0, 3)).toEqual([
      "Mid plane",
      "Mount hole",
      "Block",
    ]);
    expect(() =>
      applyStepChange(
        steps,
        { op: "move", name: "Block", after: "Block" },
        labels,
      ),
    ).toThrow("A step cannot move after itself");
  });
  it("suppresses and unsuppresses", () => {
    const off = applyStepChange(
      steps,
      { op: "suppress", name: "Deal text", suppressed: true },
      labels,
    );
    expect(off[4].suppressed).toBe(true);
    expect(
      applyStepChange(
        off,
        { op: "suppress", name: "Deal text", suppressed: false },
        labels,
      )[4].suppressed,
    ).toBe(false);
  });
  it("refuses unknown steps", () => {
    for (const change of [
      { op: "remove", name: "X" },
      { op: "edit", name: "X", inputs: {} },
      { op: "add", step: hole, after: "X" },
    ] as const)
      expect(() => applyStepChange(steps, change, labels)).toThrow(
        'No step named "X"',
      );
  });
});

describe("describeChange", () => {
  it("says what changed", () => {
    expect(describeChange({ op: "add", step: hole })).toBe(
      'Added hole "Hole 3"',
    );
    expect(describeChange({ op: "edit", name: "A", inputs: {} })).toBe(
      'Changed step "A"',
    );
    expect(describeChange({ op: "remove", name: "A" })).toBe(
      'Removed step "A"',
    );
    expect(describeChange({ op: "move", name: "A", after: null })).toBe(
      'Moved step "A" to the start',
    );
    expect(describeChange({ op: "move", name: "A", after: "B" })).toBe(
      'Moved step "A" after "B"',
    );
    expect(
      describeChange({ op: "suppress", name: "A", suppressed: true }),
    ).toBe('Turned off step "A"');
    expect(
      describeChange({ op: "suppress", name: "A", suppressed: false }),
    ).toBe('Turned on step "A"');
    expect(describeChange({ op: "rename", name: "A", newName: "B" })).toBe(
      'Renamed step "A" to "B"',
    );
  });
});
