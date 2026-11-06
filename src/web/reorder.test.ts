import { describe, expect, it } from "vitest";
import { moveAfter } from "./reorder";

const names = ["A", "B", "C", "D"];
describe("moveAfter", () => {
  it("moves to the start", () => {
    expect(moveAfter(names, "D", "A")).toBeNull();
  });
  it("moves right past the target and left before it", () => {
    expect(moveAfter(names, "A", "C")).toBe("C");
    expect(moveAfter(names, "D", "B")).toBe("A");
  });
  it("does nothing when dropped on itself", () => {
    expect(moveAfter(names, "B", "B")).toBeUndefined();
  });
});
