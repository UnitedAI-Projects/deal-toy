import { describe, expect, it } from "vitest";
import toyJson from "../../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import boxJson from "../../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import type { Check, CheckLimit, CheckTarget } from "../../shared/checks";
import type { InspectRecord } from "../../shared/inspect-types";
import { evaluateChecks, signatureOf } from "./evaluate";

const toy = toyJson as unknown as InspectRecord;
const box = boxJson as unknown as InspectRecord;
const by = { email: "a@example.test", agent: false };
const at = "2026-11-09T00:00:00.000Z";
let n = 0;
function check(
  kind: Check["kind"],
  target: CheckTarget,
  limit: CheckLimit,
  extra: Partial<Check> = {},
): Check {
  return {
    id: `c${++n}`,
    name: kind,
    kind,
    enabled: true,
    target,
    limit,
    created_by: by,
    created_at: at,
    edited_by: by,
    edited_at: at,
    ...extra,
  };
}
const one = (
  record: InspectRecord,
  c: Check,
  measurements = {},
): ReturnType<typeof evaluateChecks>[number] =>
  evaluateChecks(record, [c], measurements)[0];

describe("evaluateChecks", () => {
  it("stability passes or fails on the tip angle, and needs every density", () => {
    expect(one(toy, check("stability", {}, { min: 15 }))).toMatchObject({
      status: "pass",
      unit: "deg",
      value: toy.stability!.tip_angle_deg,
    });
    expect(one(toy, check("stability", {}, { min: 20 })).status).toBe("fail");
    expect(one(box, check("stability", {}, { min: 5 }))).toMatchObject({
      status: "unknown",
      reason: "Assumes uniform density: declare every part's density",
    });
  });

  it("embed wall measures the coin against the block", () => {
    const pass = one(toy, check("embed_wall", { part: "Coin" }, { min: 1 }));
    expect(pass).toMatchObject({ status: "pass", value: 1.5, parts: [2, 1] });
    expect(
      one(toy, check("embed_wall", { part: "Coin" }, { min: 2 })),
    ).toMatchObject({ status: "fail", value: 1.5 });
    expect(
      one(toy, check("embed_wall", { part: "Block" }, { min: 2 })).reason,
    ).toBe('"Block" is not a declared embed');
  });

  it("dimension compares the declared value with nominal ± tolerance", () => {
    const depth = { dimension: "Engraving depth" };
    expect(
      one(toy, check("dimension", depth, { nominal: 0.5, tolerance: 0.05 })),
    ).toMatchObject({ status: "fail", value: 0.3, faces: [1, 10] });
    expect(
      one(toy, check("dimension", depth, { nominal: 0.3, tolerance: 0.05 }))
        .status,
    ).toBe("pass");
    expect(
      one(toy, check("dimension", { dimension: "Nope" }, { nominal: 1 }))
        .reason,
    ).toBe('No declared dimension named "Nope"');
  });

  it("clearance between parts uses the pair; overlapping parts fail", () => {
    expect(
      one(box, check("clearance", { parts: ["Ribs", "Cover"] }, { min: 10 })),
    ).toMatchObject({ status: "pass", value: 15.391637 });
    expect(
      one(box, check("clearance", { parts: ["Housing", "Ribs"] }, { min: 0 })),
    ).toMatchObject({ status: "fail", reason: "The parts overlap" });
  });

  it("clearance between faces asks for an exact measure, then uses it", () => {
    const faces: CheckTarget = {
      faces: [signatureOf(box, 7), signatureOf(box, 47)],
    };
    const c = check("clearance", faces, { min: 0.5 });
    const pending = one(box, c);
    expect(pending).toMatchObject({
      status: "unknown",
      reason: "Needs an exact measure",
      measure: { key: "f47-f7", a: { face: 7 }, b: { face: 47 } },
    });
    expect(one(box, c, { "f47-f7": { status: "queued" } }).reason).toBe(
      "Measuring…",
    );
    expect(
      one(box, c, { "f47-f7": { status: "done", value: 0.3 } }),
    ).toMatchObject({ status: "fail", value: 0.3, faces: [7, 47] });
    expect(
      one(box, c, { "f47-f7": { status: "failed", error: "STEP gone" } }),
    ).toMatchObject({ status: "unknown", reason: "Measure failed: STEP gone" });
  });

  it("no overlap on two parts or on all parts, skipping declared embeds", () => {
    expect(
      one(box, check("no_overlap", { parts: ["Housing", "Ribs"] }, {})),
    ).toMatchObject({ status: "fail", value: 238.586239, unit: "mm³" });
    expect(one(box, check("no_overlap", { all: true }, {}))).toMatchObject({
      status: "fail",
      parts: [0, 1],
    });
    // The coin sits inside the block on purpose: a declared embed is not an overlap.
    const embedded = {
      ...toy,
      pairs: toy.pairs!.map((p) =>
        p.a === 1 && p.b === 2 ? { ...p, overlap_volume: 1356 } : p,
      ),
    };
    expect(one(embedded, check("no_overlap", { all: true }, {})).status).toBe(
      "pass",
    );
  });

  it("envelope compares the bounding box with a size", () => {
    expect(one(box, check("envelope", {}, { size: [80, 60, 32] })).status).toBe(
      "pass",
    );
    expect(
      one(box, check("envelope", { part: "Cover" }, { size: [79, 60, 32] })),
    ).toMatchObject({ status: "fail", reason: "80.00 × 60.00 × 5.00 mm" });
  });

  it("hole checks a picked hole's diameter", () => {
    const face = signatureOf(box, box.holes[0].faces[0]);
    expect(
      one(box, check("hole", { face }, { min: 2.4, max: 2.6 })),
    ).toMatchObject({ status: "pass", value: 2.5 });
    expect(
      one(box, check("hole", { face: signatureOf(box, 5) }, { min: 1 })).reason,
    ).toBe("The picked face is not a hole");
  });

  it("draft fails on vertical walls, honours exceptions, and needs a pull", () => {
    const draft = one(box, check("draft", { part: "Housing" }, { min: 1 }));
    expect(draft).toMatchObject({ status: "fail", value: 0, unit: "deg" });
    expect(draft.faces!.length).toBe(16);
    const all = box.draft![0].faces.map((f) => signatureOf(box, f.index));
    expect(
      one(
        box,
        check("draft", { part: "Housing" }, { min: 1 }, { exceptions: all }),
      ).status,
    ).toBe("pass");
    expect(one(box, check("draft", { part: "Cover" }, { min: 1 })).reason).toBe(
      'No pull direction for "Cover"',
    );
  });

  it("is never pass when it cannot be evaluated", () => {
    expect(one(toy, check("stability", {}, { min: null })).reason).toBe(
      "Limit not set (TBD: confirm with your maker)",
    );
    expect(
      one(toy, check("stability", {}, { min: 1 }, { enabled: false })),
    ).toMatchObject({ status: "unknown", reason: "Turned off" });
    const twins = {
      ...box,
      parts: box.parts.map((p) =>
        p.index === 2 ? { ...p, label: "Ribs" } : p,
      ),
    };
    expect(
      one(twins, check("clearance", { parts: ["Housing", "Ribs"] }, { min: 0 }))
        .reason,
    ).toBe('Two parts are labelled "Ribs"');
    expect(
      one(box, check("embed_wall", { part: "Ghost" }, { min: 1 })).reason,
    ).toBe('No part "Ghost" in this build');
    const truncated = { ...box, faces: [], holes: [], faces_truncated: true };
    expect(
      one(truncated, check("hole", { face: signatureOf(box, 19) }, { min: 1 }))
        .reason,
    ).toBe("Not measured: the model has over 20,000 faces");
    const many = {
      ...box,
      warnings: ["Only the first 30 parts are measured against each other"],
      pairs: [],
    };
    expect(
      one(many, check("clearance", { parts: ["Housing", "Ribs"] }, { min: 0 }))
        .reason,
    ).toBe("Not measured: only the first 30 parts are paired");
  });

  it("marks a pass within 10% of its limit as near", () => {
    expect(
      one(toy, check("embed_wall", { part: "Coin" }, { min: 1.4 })),
    ).toMatchObject({ status: "pass", near: true });
    expect(
      one(toy, check("embed_wall", { part: "Coin" }, { min: 1 })).near,
    ).toBeFalsy();
  });
});
