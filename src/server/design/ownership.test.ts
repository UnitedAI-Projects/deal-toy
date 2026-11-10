import { describe, expect, it } from "vitest";
import fixture from "../../../engine/tests/fixtures/deal_toy.py";
import bridge from "../../../examples/bridge.py";
import { compareSources, layerNames } from "./ownership";

/** A model in the standard steps layout, like script() in engine/tests/test_mantel.py. */
function script(
  steps: string[],
  { base = "None", params = "{}", extra = "" } = {},
) {
  return (
    "import build123d as bd\nimport mantel as mt\n\n" +
    `PARAMS = ${params}\n\n${extra}\n\n` +
    `def base():\n    return ${base}\n\n\n` +
    "def build():\n" +
    "    m = mt.Model(base(), params=PARAMS)\n" +
    "    # mantel:steps begin\n" +
    steps.map((s) => `    ${s}\n`).join("") +
    "    # mantel:steps end\n" +
    "    return m.result()\n"
  );
}

const BLOCK = 'm.body("Block", shape="box", size=(40, 20, 30))';
const hole = (d: number) =>
  `m.hole("Mount hole", on=m.face("Block", "bottom"), diameter=${d}, extent="through")`;
const NOTCH = 'm.custom("Notch", fn=notch, on=m.face("Block", "front"))';
const notchFn = (depth: number) =>
  `def notch(m, on):\n    return ${depth}\n\n\ndef unused(m):\n    return \"helper\"\n`;

const unchanged = {
  added: [],
  removed: [],
  edited: [],
  moved: [],
  params: false,
  shared: false,
};

describe("compareSources", () => {
  it("reports added, removed and edited layers", () => {
    const before = script([BLOCK, hole(4)]);
    expect(compareSources(before, script([BLOCK, hole(5)]))).toMatchObject({
      ...unchanged,
      layout: true,
      base: "empty",
      edited: ["Mount hole"],
    });
    const added =
      'm.fillet("Edges", edges=m.edges("Block", around="top"), radius=1)';
    expect(
      compareSources(before, script([BLOCK, hole(4), added])),
    ).toMatchObject({ ...unchanged, added: ["Edges"] });
    expect(compareSources(before, script([BLOCK]))).toMatchObject({
      ...unchanged,
      removed: ["Mount hole"],
    });
  });

  it("attributes a custom function to the layers that call it", () => {
    const before = script([BLOCK, NOTCH], { extra: notchFn(1) });
    const called = script([BLOCK, NOTCH], { extra: notchFn(2) });
    expect(compareSources(before, called)).toMatchObject({
      ...unchanged,
      edited: ["Notch"],
    });
    const helper = script([BLOCK, NOTCH], {
      extra: notchFn(1).replace('"helper"', '"changed"'),
    });
    expect(compareSources(before, helper)).toMatchObject({
      ...unchanged,
      shared: true,
    });
  });

  it("flags PARAMS changes", () => {
    const params = (v: number) => `{"W": {"value": ${v}, "unit": "mm"}}`;
    expect(
      compareSources(
        script([BLOCK], { params: params(40) }),
        script([BLOCK], { params: params(50) }),
      ),
    ).toMatchObject({ ...unchanged, params: true });
  });

  it("ignores trailing whitespace and blank-line churn but not comments", () => {
    const before = script([BLOCK, hole(4)], { extra: notchFn(1) });
    const churn = before
      .replace("import mantel as mt\n", "import mantel as mt   \n\n\n")
      .replace("def unused(m):", "def unused(m):  ")
      .concat("\n\n");
    expect(compareSources(before, churn)).toMatchObject(unchanged);
    const commented = before.replace(
      "def build():",
      "# Builds the model.\ndef build():",
    );
    expect(compareSources(before, commented)).toMatchObject({
      ...unchanged,
      shared: true,
    });
  });

  it("detects base code", () => {
    expect(compareSources(null, script([BLOCK])).base).toBe("empty");
    const doc = script([BLOCK]).replace(
      "def base():\n",
      'def base():\n    """Nothing; every part is a layer."""\n    # no geometry\n',
    );
    expect(compareSources(null, doc).base).toBe("empty");
    expect(
      compareSources(null, script([BLOCK], { base: "bd.Box(1, 1, 1)" })).base,
    ).toBe("code");
    const noBase = script([BLOCK])
      .replace("def base():\n    return None\n", "")
      .replace("mt.Model(base(),", "mt.Model(None,");
    expect(compareSources(null, noBase).base).toBe("missing");
  });

  it("moving one layer reports only that layer", () => {
    const lines = fixture.split("\n");
    const at = lines.findIndex((l) => l.includes('m.text("Deal text"'));
    const [deal] = lines.splice(at, 1);
    lines.splice(
      lines.findIndex((l) => l.includes('m.hole("Mount hole",')),
      0,
      deal,
    );
    const moved = lines.join("\n");
    expect(compareSources(fixture, moved)).toMatchObject({
      ...unchanged,
      moved: ["Deal text"],
    });
  });

  it("prefers layers the caller may move when a swap is ambiguous", () => {
    const rim =
      'm.fillet("Rim", edges=m.edges("Block", around="top"), radius=1)';
    const before = script([BLOCK, hole(4), rim]);
    const after = script([BLOCK, rim, hole(4)]);
    expect(
      compareSources(before, after, new Set(["Mount hole"])).moved,
    ).toEqual(["Mount hole"]);
    expect(compareSources(before, after, new Set(["Rim"])).moved).toEqual([
      "Rim",
    ]);
  });

  it("reports every layer as added with no previous source", () => {
    expect(compareSources(null, script([BLOCK, hole(4)]))).toMatchObject({
      ...unchanged,
      added: ["Block", "Mount hole"],
    });
  });

  it("free-form scripts have no layout", () => {
    expect(compareSources(null, bridge).layout).toBe(false);
    expect(layerNames(bridge)).toBeNull();
    const wider = bridge.replace('"value": 100.0', '"value": 120.0');
    expect(compareSources(bridge, wider)).toMatchObject({
      ...unchanged,
      layout: false,
      params: true,
    });
    expect(layerNames(script([BLOCK, hole(4)]))).toEqual([
      "Block",
      "Mount hole",
    ]);
  });
});
