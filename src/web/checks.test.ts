import { describe, expect, it } from "vitest";
import toyJson from "../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import boxJson from "../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import type { Check, CheckResult } from "../shared/checks";
import type { InspectRecord } from "../shared/inspect-types";
import {
  checkFromSelection,
  limitText,
  overlayTones,
  resultText,
} from "./checks";

const toy = toyJson as unknown as InspectRecord;
const box = boxJson as unknown as InspectRecord;
const kinds = (drafts: { kind: string }[]) => drafts.map((d) => d.kind);
const by = { email: "a@example.test", agent: false };
const check = (kind: Check["kind"], extra: Partial<Check> = {}): Check => ({
  id: kind,
  name: kind,
  kind,
  enabled: true,
  target: {},
  limit: {},
  created_by: by,
  created_at: "",
  edited_by: by,
  edited_at: "",
  ...extra,
});

describe("checkFromSelection", () => {
  it("offers whole-model checks when nothing is picked", () => {
    expect(kinds(checkFromSelection(toy, []))).toEqual([
      "stability",
      "envelope",
    ]);
  });
  it("offers clearance and no overlap for two parts", () => {
    const drafts = checkFromSelection(box, [
      { label: "Housing" },
      { label: "Ribs" },
    ]);
    expect(kinds(drafts)).toEqual(["clearance", "no_overlap"]);
    expect(drafts[0]).toMatchObject({
      target: { parts: ["Housing", "Ribs"] },
      limit: { min: null },
    });
  });
  it("offers clearance between two faces, with their signatures", () => {
    const [draft] = checkFromSelection(box, [
      { label: "Housing", face: 7 },
      { label: "Cover", face: 47 },
    ]);
    expect(draft.kind).toBe("clearance");
    const faces = (draft.target as { faces: { signature: { part: string } }[] })
      .faces;
    expect(faces.map((f) => f.signature.part)).toEqual(["Housing", "Cover"]);
  });
  it("offers a hole check on a hole wall and a dimension check on a declared face", () => {
    expect(
      kinds(checkFromSelection(box, [{ label: "Housing", face: 19 }])),
    ).toContain("hole");
    const dims = checkFromSelection(box, [{ label: "Cover", face: 47 }]);
    expect(dims.find((d) => d.kind === "dimension")).toMatchObject({
      target: { dimension: "Lip clearance" },
      limit: { nominal: null, tolerance: null },
    });
  });
  it("offers embed wall for an embed and draft for a part with a pull", () => {
    expect(kinds(checkFromSelection(toy, [{ label: "Coin" }]))).toContain(
      "embed_wall",
    );
    expect(kinds(checkFromSelection(box, [{ label: "Housing" }]))).toContain(
      "draft",
    );
    expect(kinds(checkFromSelection(box, [{ label: "Cover" }]))).not.toContain(
      "draft",
    );
  });
});

describe("overlayTones", () => {
  const results: CheckResult[] = [
    { id: "no_overlap", status: "fail", parts: [0, 1], value: 238 },
    { id: "clearance", status: "fail", faces: [7, 47], value: 0.3 },
    { id: "draft", status: "fail", faces: [5, 6], value: 0 },
    { id: "stability", status: "pass" },
  ];
  const checks = [
    check("no_overlap"),
    check("clearance"),
    check("draft"),
    check("stability"),
  ];
  const all = { overlap: true, clearance: true, draft: true };
  it("colours overlaps red and clearance or draft failures amber", () => {
    const tones = overlayTones(box, results, checks, all);
    const housing = box.faces.filter((f) => f.part === 0).map((f) => f.index);
    expect(tones.fail).toEqual(expect.arrayContaining(housing));
    expect(tones.warn).toEqual([5, 6, 7, 47]);
  });
  it("turns each colour off with its switch", () => {
    const tones = overlayTones(box, results, checks, {
      ...all,
      overlap: false,
      draft: false,
    });
    expect(tones.fail).toEqual([]);
    expect(tones.warn).toEqual([7, 47]);
  });
});

describe("resultText and limitText", () => {
  it("formats values and the change since the previous revision", () => {
    expect(
      resultText(
        { id: "a", status: "fail", value: 0.1, unit: "mm" },
        { revision: 6, status: "pass", value: 0.3 },
        7,
      ),
    ).toEqual({
      value: "0.10 mm",
      change: "0.30 mm in rev 6 → 0.10 mm in rev 7",
    });
    expect(
      resultText({ id: "a", status: "pass", value: 17.06723, unit: "deg" }),
    ).toEqual({ value: "17.1°" });
    expect(
      resultText(
        { id: "a", status: "pass", value: 2, unit: "mm" },
        { revision: 1, status: "pass", value: 2 },
        2,
      ),
    ).toEqual({ value: "2.00 mm" });
  });
  it("says TBD for unset limits", () => {
    expect(limitText(check("embed_wall", { limit: { min: 2 } }))).toBe(
      "≥ 2.00 mm",
    );
    expect(limitText(check("stability", { limit: { min: null } }))).toBe(
      "TBD: confirm with your maker",
    );
    expect(
      limitText(
        check("dimension", { limit: { nominal: 0.5, tolerance: 0.05 } }),
      ),
    ).toBe("0.50 ± 0.05 mm");
    expect(limitText(check("hole", { limit: { min: 2.4, max: 2.6 } }))).toBe(
      "2.40–2.60 mm",
    );
    expect(
      limitText(check("envelope", { limit: { size: [80, 60, 32] } })),
    ).toBe("≤ 80.00 × 60.00 × 32.00 mm");
    expect(limitText(check("no_overlap"))).toBe("≤ 0.001 mm³");
    expect(limitText(check("draft", { limit: { min: 1 } }))).toBe("≥ 1.0°");
  });
});
