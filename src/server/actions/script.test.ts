import { describe, expect, it } from "vitest";
import fixture from "../../../engine/tests/fixtures/deal_toy.py";
import bridge from "../../../examples/bridge.py";
import { readSteps, renderStep, writeSteps, type Step } from "./script";

const BEGIN = "    # mantel:steps begin\n";
const END = "    # mantel:steps end\n";
function model(section: string, head = "") {
  return `import mantel as mt\n${head}\ndef build():\n    m = mt.Model(None)\n${BEGIN}${section}${END}    return m.result()\n`;
}

describe("readSteps / writeSteps", () => {
  it("round-trips the fixture section", () => {
    const { steps } = readSteps(fixture);
    expect(steps.map((s) => s.name)).toEqual([
      "Block",
      "Mid plane",
      "Mount hole",
      "Mount hole 2",
      "Deal text",
      "Coin cavity",
      "Block edges",
    ]);
    expect(writeSteps(fixture, steps)).toBe(fixture);
  });
  it("parses references, parameters and literals", () => {
    const { steps } = readSteps(fixture);
    expect(steps[0]).toMatchObject({
      action: "body",
      name: "Block",
      suppressed: false,
      inputs: {
        shape: "box",
        size: [{ param: "BLOCK_W" }, 40, 60],
        on: { ref: "face", of: "Base", name: "top" },
      },
    });
    expect(steps[3].inputs.at).toEqual([{ param: "HOLE_X" }, 0, 0]);
    expect(steps[5].inputs).toEqual({
      target: { ref: "part", label: "Block" },
      tool: { ref: "part", label: "Coin" },
      operation: "cut",
      keep_tool: true,
    });
    expect(steps[6].inputs.edges).toEqual({
      ref: "edges",
      of: "Block",
      around: "top",
    });
  });
  it("changes nothing outside the markers", () => {
    const { steps, start, end } = readSteps(fixture);
    const edited = writeSteps(fixture, [
      ...steps.slice(0, 2),
      { ...steps[2], inputs: { ...steps[2].inputs, diameter: 6 } },
    ]);
    const after = readSteps(edited);
    expect(edited.slice(0, after.start)).toBe(fixture.slice(0, start));
    expect(edited.slice(after.end)).toBe(fixture.slice(end));
    expect(after.steps).toHaveLength(3);
    expect(after.steps[2].inputs.diameter).toBe(6);
    expect(edited).toContain(
      '    m.hole("Mount hole", on=m.face("Base", "bottom"), at=(-30, 0, 0), diameter=6, extent="through")\n',
    );
  });
  it("keeps tricky strings", () => {
    const tricky = 'ACME × "GLOBEX" #1 \\ end';
    const step: Step = {
      action: "text",
      name: "Deal # text",
      inputs: {
        on: { ref: "face", of: "Base", name: "front" },
        text: tricky,
        height: 6,
        depth: 0.5,
      },
      suppressed: false,
    };
    const source = model(renderStep(step));
    const [read] = readSteps(source).steps;
    expect(read.inputs.text).toBe(tricky);
    expect(read.name).toBe("Deal # text");
    expect(writeSteps(source, readSteps(source).steps)).toBe(source);
  });
  it("renders suppressed last and only when true", () => {
    const step: Step = {
      action: "plane",
      name: "Mid",
      inputs: {
        method: "offset",
        reference: { ref: "datum", name: "A" },
        distance: -2.5,
      },
      suppressed: true,
    };
    expect(renderStep(step)).toBe(
      '    m.plane("Mid", method="offset", reference=m.datum("A"), distance=-2.5, suppressed=True)\n',
    );
    expect(renderStep({ ...step, suppressed: false })).not.toContain(
      "suppressed",
    );
  });
  it("renders queries, points, functions and nested values", () => {
    const step: Step = {
      action: "custom",
      name: "Notch",
      inputs: {
        fn: { fn: "notch" },
        on: { ref: "face", of: "Lid", normal: [0, 0, 1], near: [1.5, 2, 3] },
        edges: { ref: "edges", of: "Lid", between: ["top", "front"] },
        where: { ref: "point", at: [1, 2, 3] },
        options: { deep: true, list: ["a", null] },
      },
      suppressed: false,
    };
    const text = renderStep(step);
    expect(text).toBe(
      '    m.custom("Notch", fn=notch, on=m.face("Lid", normal=(0, 0, 1), near=(1.5, 2, 3)), edges=m.edges("Lid", between=("top", "front")), where=m.point(1, 2, 3), options={"deep": True, "list": ["a", None]})\n',
    );
    expect(readSteps(model(text)).steps[0].inputs).toEqual(step.inputs);
  });
  it("accepts multi-line calls, comments and blank lines", () => {
    const section =
      '    # the block first\n    m.body(\n        "Block",\n        shape="box",  # a box\n        size=(1, 2, 3),\n    )\n\n    m.body("Lid", shape="sphere", diameter=4)\n';
    const source = model(section);
    const { steps } = readSteps(source);
    expect(steps.map((s) => s.name)).toEqual(["Block", "Lid"]);
    expect(writeSteps(source, steps)).toBe(source);
    const renamed = writeSteps(source, [
      steps[0],
      { ...steps[1], name: "Cap" },
    ]);
    expect(renamed).toContain("    # the block first\n    m.body(\n");
    expect(renamed).toContain(
      '\n\n    m.body("Cap", shape="sphere", diameter=4)\n',
    );
  });
  it("writes an empty section", () => {
    const source = model('    m.body("A", shape="sphere", diameter=4)\n');
    expect(writeSteps(source, [])).toBe(model(""));
    expect(readSteps(model("")).steps).toEqual([]);
  });
  it("refuses a model without a steps section", () => {
    expect(() => readSteps(bridge)).toThrow(
      "This model has no steps section; ask the agent to adopt the standard model layout",
    );
  });
  it("refuses misplaced markers", () => {
    const inString = `import mantel as mt\nX = """\n${BEGIN}${END}"""\ndef build():\n    return None\n`;
    expect(() => readSteps(inString)).toThrow("no steps section");
    const twice = model(`${BEGIN}`);
    expect(() => readSteps(twice)).toThrow("more than one steps section");
    const backwards = `def build():\n${END}${BEGIN}    return 1\n`;
    expect(() => readSteps(backwards)).toThrow("steps section is malformed");
    const outside = `${BEGIN.trimStart()}${END.trimStart()}def build():\n    return 1\n`;
    expect(() => readSteps(outside)).toThrow("steps section is malformed");
  });
  it("refuses non-step lines", () => {
    expect(() => readSteps(model("    x = 1\n"))).toThrow(
      "Line 6 is not a step; ask the agent to tidy the steps section",
    );
    expect(() => readSteps(model('    m.hole(name="A")\n'))).toThrow(
      "Line 6 is not a step",
    );
    expect(() =>
      readSteps(model('    m.body("A", size=(1, 2) + (3,))\n')),
    ).toThrow("Line 6 is not a step");
    expect(() => readSteps(model('    m.body("A", shape=f"box")\n'))).toThrow(
      "Line 6 is not a step",
    );
  });
});
