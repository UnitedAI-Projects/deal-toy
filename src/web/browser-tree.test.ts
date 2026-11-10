import { describe, expect, it } from "vitest";
import { browserTree } from "./browser-tree";

const shape = (tree: ReturnType<typeof browserTree>) =>
  tree.map((f) => [f.folder, f.items.map((i) => i.label)]);

describe("browserTree", () => {
  it("shows only the origin on an empty model", () => {
    const tree = browserTree({ parts: [], steps: [] });
    expect(shape(tree)).toEqual([
      ["Origin", ["XY", "XZ", "YZ", "X", "Y", "Z"]],
    ]);
  });
  it("lists bodies and construction planes after the origin", () => {
    const tree = browserTree({
      parts: ["Base", "Coin"],
      steps: [
        { name: "Base", action: "body" },
        { name: "Mid plane", action: "plane" },
        { name: "Round", action: "fillet" },
      ],
    });
    expect(shape(tree)).toEqual([
      ["Origin", ["XY", "XZ", "YZ", "X", "Y", "Z"]],
      ["Bodies", ["Base", "Coin"]],
      ["Construction", ["Mid plane"]],
    ]);
  });
});
