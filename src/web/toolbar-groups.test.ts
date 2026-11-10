import { describe, expect, it } from "vitest";
import catalog from "../../engine/lib/mantel/catalog.json";
import type { ToolbarAction } from "./Toolbar";
import { searchActions, toolbarGroups } from "./toolbar-groups";

const builtins = (catalog.actions as unknown as ToolbarAction[]).filter(
  (a) => a.id !== "custom",
);
const saved: ToolbarAction = {
  id: "saved:7f3a-knurl",
  title: "Knurled grip",
  category: "Custom",
  summary: "A team action that knurls a cylinder",
};
const all = [...builtins, saved];
const ids = (list: ToolbarAction[]) => list.map((a) => a.id);

describe("toolbarGroups", () => {
  const groups = toolbarGroups(all);
  const group = (name: string) => groups.find((g) => g.group === name)!;
  it("orders the groups and leaves out empty ones", () => {
    expect(groups.map((g) => g.group)).toEqual([
      "Create",
      "Modify",
      "Arrange",
      "Construct",
      "Custom",
    ]);
  });
  it("puts an action in its group, falling back to its category", () => {
    expect(
      ids([...group("Modify").featured, ...group("Modify").more]),
    ).toContain("combine");
  });
  it("shows featured actions as buttons in catalog order", () => {
    expect(ids(group("Create").featured)).toEqual(["body", "extrude", "hole"]);
  });
  it("lists saved actions under Custom", () => {
    expect(ids(group("Custom").more)).toEqual([saved.id]);
    expect(group("Custom").featured).toEqual([]);
  });
});

describe("searchActions", () => {
  it("puts title-prefix matches first", () => {
    expect(searchActions(all, "fil")[0].id).toBe("fillet");
  });
  it("finds an action by its summary", () => {
    expect(ids(searchActions(all, "bevel"))).toContain("chamfer");
  });
  it("finds a saved action by its id", () => {
    expect(ids(searchActions(all, saved.id))).toEqual([saved.id]);
  });
  it("returns nothing for an empty query", () => {
    expect(searchActions(all, "")).toEqual([]);
    expect(searchActions(all, "   ")).toEqual([]);
  });
});
