import { describe, expect, it } from "vitest";
import fitJson from "../../engine/tests/fixtures/display_box_fit.inspect.json";
import boxJson from "../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import type { InspectRecord } from "../shared/inspect-types";
import {
  attachmentText,
  commitsFor,
  fitLabel,
  fitStep,
  initialFit,
  type FitState,
} from "./fit-state";

const fit = fitJson as unknown as InspectRecord;
const box = boxJson as unknown as InspectRecord;
const hinge = fit.joints!.findIndex((j) => j.name === "hinge");
const slide = fit.joints!.findIndex((j) => j.name === "slide");

function dragged(commits: boolean) {
  let s: FitState = fitStep(initialFit("b1"), {
    type: "start",
    joint: hinge,
    value: 0,
  }).state;
  s = fitStep(s, { type: "move", value: 60 }).state;
  return fitStep(s, { type: "release", commits });
}

describe("fitStep", () => {
  it("commits a release exactly once when a matching placement drives the joint", () => {
    const first = dragged(true);
    expect(first.commit).toEqual({ joint: hinge, value: 60 });
    expect(first.state.poses).toEqual({ [hinge]: 60 });
    expect(first.state.previewing).toBe(true);
    expect(
      fitStep(first.state, { type: "release", commits: true }).commit,
    ).toBeUndefined();
  });
  it("leaves a view-only pose when it may not commit", () => {
    const { state, commit } = dragged(false);
    expect(commit).toBeUndefined();
    expect(state.poses).toEqual({ [hinge]: 60 });
    expect(state.viewOnly).toBe(true);
    expect(fitStep(state, { type: "reset" }).state.poses).toEqual({});
  });
  it("does nothing on a release that did not move", () => {
    let s = fitStep(initialFit("b1"), {
      type: "start",
      joint: hinge,
      value: 0,
    }).state;
    const out = fitStep(s, { type: "release", commits: true });
    expect(out.commit).toBeUndefined();
    expect(out.state.poses).toEqual({});
    s = out.state;
    expect(s.drag).toBeNull();
  });
  it("cancels back to the pose from before the drag", () => {
    let s = dragged(false).state;
    s = fitStep(s, { type: "start", joint: hinge, value: 60 }).state;
    s = fitStep(s, { type: "move", value: 90 }).state;
    expect(s.poses[hinge]).toBe(90);
    s = fitStep(s, { type: "cancel" }).state;
    expect(s.poses).toEqual({ [hinge]: 60 });
    expect(s.drag).toBeNull();
  });
  it("clears poses and an in-flight drag when a new build arrives", () => {
    let s = dragged(true).state;
    s = fitStep(s, { type: "start", joint: slide, value: 0 }).state;
    s = fitStep(s, { type: "explode", amount: 0.4 }).state;
    const next = fitStep(s, { type: "record", buildId: "b2" }).state;
    expect(next).toMatchObject({
      buildId: "b2",
      poses: {},
      drag: null,
      previewing: false,
      viewOnly: false,
      explode: 0.4,
    });
    expect(fitStep(next, { type: "record", buildId: "b2" }).state).toBe(next);
  });
  it("keeps the explode amount between 0 and 1", () => {
    expect(
      fitStep(initialFit(null), { type: "explode", amount: 3 }).state.explode,
    ).toBe(1);
    expect(
      fitStep(initialFit(null), { type: "explode", amount: Number.NaN }).state
        .explode,
    ).toBe(0);
    const open = fitStep(initialFit(null), {
      type: "explode",
      amount: 0.5,
    }).state;
    expect(fitStep(open, { type: "collapse" }).state.explode).toBe(0);
  });
});

describe("commitsFor", () => {
  it("needs a placement whose parameter matches, and edit rights", () => {
    expect(commitsFor(fit, hinge, true)?.name).toBe("Lid angle");
    expect(commitsFor(fit, hinge, false)).toBeNull();
    const stale: InspectRecord = {
      ...fit,
      dimensions: fit.dimensions!.map((d) => ({ ...d, matches_param: false })),
    };
    expect(commitsFor(stale, hinge, true)).toBeNull();
    const plaque = fit.joints!.findIndex((j) => j.name === "plaque");
    expect(commitsFor(fit, plaque, true)).toBeNull();
  });
});

describe("labels", () => {
  it("names the drag and says whether it is saved", () => {
    let s = fitStep(initialFit("b1"), {
      type: "start",
      joint: hinge,
      value: 0,
    }).state;
    s = fitStep(s, { type: "move", value: 42 }).state;
    expect(fitLabel(fit, s)).toBe("Lid angle 42.0° · Preview");
    expect(fitLabel(fit, dragged(false).state)).toBe(
      "Lid angle 60.0° · View only: not saved",
    );
    expect(fitLabel(fit, initialFit("b1"))).toBeNull();
  });
  it("says how a part attaches", () => {
    expect(attachmentText(fit, "Lid")).toBe(
      'Attached to Base by "hinge" (revolute) · 0.0° (0.0–110.0°)',
    );
    expect(attachmentText(fit, "Drawer")).toBe(
      'Attached to Base by "slide" (linear) · 0.00 mm (0.00–40.00 mm)',
    );
    expect(attachmentText(fit, "Plaque")).toBe('Fixed to Lid by "plaque"');
    expect(attachmentText(fit, "Base")).toBe("Not attached by a joint");
    expect(attachmentText(box, "Housing")).toBeNull();
    const stale: InspectRecord = {
      ...fit,
      dimensions: fit.dimensions!.map((d) => ({ ...d, matches_param: false })),
    };
    expect(attachmentText(stale, "Lid")).toBe(
      'Attached to Base by "hinge" (revolute) · 0.0° (0.0–110.0°). Lid angle doesn\'t match LID_ANGLE, so dragging is view only; ask the agent to fix it',
    );
  });
});
