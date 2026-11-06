import { describe, expect, it } from "vitest";
import type { StepLog } from "./api";
import { asOfLabel } from "./timeline-chips";

const steps = [
  "Block",
  "Mid plane",
  "Mount hole",
  "Mount hole 2",
  "Deal text",
  "Coin cavity",
  "Block edges",
].map((name): StepLog => ({
  name,
  action: "hole",
  version: 1,
  state: "ok",
  created: [],
  ms: 1,
}));

describe("asOfLabel", () => {
  it("names the step and its position", () => {
    expect(asOfLabel(steps, "Mount hole")).toBe(
      "As of step 3 of 7: Mount hole",
    );
  });
  it("falls back to the name for an unknown step", () => {
    expect(asOfLabel(steps, "Gone")).toBe("As of Gone");
  });
});
