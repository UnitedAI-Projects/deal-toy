import { describe, expect, it } from "vitest";
import { DEMO_TOTAL_MS, stepDurations } from "./DemoPlayer";
import { emptyPhaseState } from "./phases";
import type { DemoStep } from "../shared/demo";

const step = (over: Partial<DemoStep> = {}): DemoStep => ({
  phase: "brief",
  kind: "manual",
  title: "A step",
  caption: "What it shows",
  revision: 0,
  state: emptyPhaseState(),
  ...over,
});

describe("demo timing", () => {
  it("plays every demo in one minute, giving longer turns more of it", () => {
    const steps = [
      step(),
      step({
        kind: "agent",
        prompt: "x".repeat(200),
        response: "y".repeat(600),
      }),
      step({ ms: 9000 }),
    ];
    const durations = stepDurations(steps);
    expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(DEMO_TOTAL_MS);
    expect(durations[1]).toBeGreaterThan(durations[0]);
    expect(
      stepDurations(Array.from({ length: 28 }, () => step()))[0],
    ).toBeCloseTo(DEMO_TOTAL_MS / 28);
  });
});
