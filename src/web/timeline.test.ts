import { describe, expect, it } from "vitest";
import type { StepLog } from "./api";
import { timelineChips } from "./timeline-chips";

const step = (
  state: StepLog["state"],
  extra: Partial<StepLog> = {},
): StepLog => ({
  name: `Step ${state}`,
  action: "hole",
  version: 1,
  state,
  created: [],
  ms: 1,
  ...extra,
});

describe("timelineChips", () => {
  it("maps every state to a tone", () => {
    const chips = timelineChips(
      (["ok", "warning", "failed", "blocked", "suppressed"] as const).map((s) =>
        step(s),
      ),
      false,
    );
    expect(chips.map((c) => [c.state, c.tone])).toEqual([
      ["ok", "ok"],
      ["warning", "warn"],
      ["failed", "bad"],
      ["blocked", "bad"],
      ["suppressed", "muted"],
    ]);
  });
  it("explains a failure with the catalog's fix", () => {
    const [chip] = timelineChips(
      [
        step("failed", {
          code: "face_not_found",
          message: "The bottom of Base no longer exists",
        }),
      ],
      false,
    );
    expect(chip.detail).toContain("The bottom of Base no longer exists");
    expect(chip.detail).toContain(
      "Pick the face again, or refer to a name an earlier step created.",
    );
    expect(chip.title).toBe("Hole");
  });
  it("shows pending while a new build runs", () => {
    const chips = timelineChips(
      [step("ok"), step("failed", { code: "no_edges" })],
      true,
    );
    expect(chips.map((c) => [c.state, c.tone])).toEqual([
      ["pending", "muted"],
      ["pending", "muted"],
    ]);
    expect(chips[1].detail).toContain("Last build: failed");
  });
  it("describes each state", () => {
    const [chip] = timelineChips(
      [
        step("blocked", {
          message: 'Refers to "Mid plane", which is suppressed',
        }),
      ],
      false,
    );
    expect(chip.meaning).toMatch(/not run because it refers/);
    expect(chip.detail).toBe('Refers to "Mid plane", which is suppressed');
  });
});
