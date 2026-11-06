import { describe, expect, it } from "vitest";
import fixture from "../../../engine/tests/fixtures/deal_toy.py";
import raw from "../../../engine/tests/fixtures/deal_toy.facts.json";
import type { StepLog } from "./catalog";
import { readSteps, type Step } from "./script";
import { modelSummary, SUMMARY_LIMIT, type SummaryInput } from "./summary";

const facts = raw as unknown as NonNullable<SummaryInput["facts"]> & {
  steps: StepLog[];
};

const steps = readSteps(fixture).steps;
const base = { name: "Tombstone", revision: 1, steps };

describe("modelSummary", () => {
  it("summarises the fixture", () => {
    expect(modelSummary({ ...base, status: "succeeded", facts })).toBe(
      [
        'Model "Tombstone" r1, build ok.',
        'Steps: 1 body "Block" ok · 2 plane "Mid plane" ok · 3 hole "Mount hole" ok · 4 hole "Mount hole 2" ok · 5 text "Deal text" ok · 6 combine "Coin cavity" ok · 7 fillet "Block edges" ok',
        "Parts: Base, Coin, Block. Planes: Mid plane. Params: BLOCK_W=80 mm, HOLE_D=5 mm, HOLE_X=20 mm.",
      ].join("\n"),
    );
  });
  it("reports failures, warnings and suppressed steps", () => {
    const log = facts.steps.map((s) =>
      s.name === "Mount hole"
        ? {
            ...s,
            state: "failed",
            code: "face_not_found",
            message: "The bottom of Base no longer exists",
          }
        : s.name === "Block edges"
          ? {
              ...s,
              state: "warning",
              message: "Radius reduced from 50 mm to 19.99 mm",
            }
          : s,
    );
    const text = modelSummary({
      ...base,
      status: "succeeded",
      facts: { ...facts, steps: log as StepLog[], incomplete: true },
      steps: steps.map((s) =>
        s.name === "Deal text" ? { ...s, suppressed: true } : s,
      ),
    });
    expect(text.split("\n")[0]).toBe('Model "Tombstone" r1, build incomplete.');
    expect(text).toContain(
      '3 hole "Mount hole" failed face_not_found (The bottom of Base no longer exists)',
    );
    expect(text).toContain(
      '7 fillet "Block edges" warning (Radius reduced from 50 mm to 19.99 mm)',
    );
    expect(text).toContain('5 text "Deal text" suppressed');
  });
  it("marks pending steps while building", () => {
    const added: Step = {
      action: "hole",
      name: "Hole 3",
      inputs: {},
      suppressed: false,
    };
    const text = modelSummary({
      ...base,
      revision: 2,
      status: "running",
      facts: null,
      steps: [...steps, added],
    });
    expect(text.split("\n")[0]).toBe('Model "Tombstone" r2, build building.');
    expect(text).toContain('8 hole "Hole 3" pending');
    expect(text).toContain('1 body "Block" pending');
  });
  it("reports failed and unbuilt models", () => {
    expect(
      modelSummary({ ...base, status: "failed", facts: null }).split("\n")[0],
    ).toBe('Model "Tombstone" r1, build failed.');
    expect(
      modelSummary({ ...base, status: null, facts: null }).split("\n")[0],
    ).toBe('Model "Tombstone" r1, build not built.');
  });
  it("keeps failures when truncating", () => {
    const many: Step[] = Array.from({ length: 40 }, (_, i) => ({
      action: "fillet",
      name: `A rather long step name for edge group number ${i}`,
      inputs: {},
      suppressed: false,
    }));
    const log = many.map((s, i) => ({
      name: s.name,
      action: "fillet",
      version: 1,
      state: i === 3 || i === 37 ? "failed" : "ok",
      code: i === 3 || i === 37 ? "no_edges" : undefined,
      message: i === 3 || i === 37 ? "No edges match" : undefined,
      created: [],
      ms: 1,
    }));
    const text = modelSummary({
      ...base,
      steps: many,
      status: "succeeded",
      facts: { ...facts, steps: log as StepLog[], incomplete: true },
    });
    expect(text.length).toBeLessThanOrEqual(SUMMARY_LIMIT);
    expect(SUMMARY_LIMIT).toBe(1500);
    expect(text).toContain('edge group number 3" failed no_edges');
    expect(text).toContain('edge group number 37" failed no_edges');
    expect(text).toMatch(/\(\+\d+ earlier ok steps\)/);
    expect(text).toContain('edge group number 39" ok');
  });
  it("leaves out the steps line for a free-form model", () => {
    const text = modelSummary({
      ...base,
      steps: null,
      status: "succeeded",
      facts: { ...facts, steps: undefined },
    });
    expect(text).not.toContain("Steps:");
    expect(text).toContain("Parts: Base, Coin, Block.");
  });
});
