/** Pure helpers for the Checks panel: suggestions from a selection, model colours and value text. */
import {
  signatureOf,
  type Check,
  type CheckKind,
  type CheckLimit,
  type CheckResult,
  type CheckTarget,
} from "../shared/checks";
import type { InspectRecord } from "../shared/inspect-types";

export type CheckDraft = {
  name: string;
  kind: CheckKind;
  target: CheckTarget;
  limit: CheckLimit;
};
export type Pick = { label: string; face?: number };

const draft = (
  name: string,
  kind: CheckKind,
  target: CheckTarget,
  limit: CheckLimit,
): CheckDraft => ({ name, kind, target, limit });

/** The checks that make sense for what is picked. Every limit starts unset, for a person to enter. */
export function checkFromSelection(
  record: InspectRecord,
  picks: Pick[],
): CheckDraft[] {
  if (!picks.length)
    return [
      draft("Stands up", "stability", {}, { min: null }),
      draft("Fits the envelope", "envelope", {}, { size: null }),
    ];
  const faces = picks.filter((p) => p.face !== undefined);
  if (picks.length === 2 && faces.length === 2)
    return [
      draft(
        `Gap ${picks[0].label}–${picks[1].label}`,
        "clearance",
        {
          faces: [
            signatureOf(record, faces[0].face!),
            signatureOf(record, faces[1].face!),
          ],
        },
        { min: null },
      ),
    ];
  if (picks.length === 2) {
    const parts: [string, string] = [picks[0].label, picks[1].label];
    return [
      draft(
        `Clearance ${parts.join("–")}`,
        "clearance",
        { parts },
        { min: null },
      ),
      draft(`No overlap ${parts.join("–")}`, "no_overlap", { parts }, {}),
    ];
  }
  const [pick] = picks;
  const out: CheckDraft[] = [];
  if (pick.face !== undefined) {
    const hole = record.holes.find((h) => h.faces.includes(pick.face!));
    if (hole)
      out.push(
        draft(
          `Hole ⌀${hole.diameter.toFixed(2)}`,
          "hole",
          { face: signatureOf(record, pick.face) },
          { min: null, max: null },
        ),
      );
    for (const d of record.dimensions ?? [])
      if (d.faces.includes(pick.face))
        out.push(
          draft(
            d.name,
            "dimension",
            { dimension: d.name },
            {
              nominal: null,
              tolerance: null,
            },
          ),
        );
    return out;
  }
  const index = record.parts.findIndex((p) => p.label === pick.label);
  if (record.embeds?.some((e) => e.part === index))
    out.push(
      draft(
        `${pick.label} wall`,
        "embed_wall",
        { part: pick.label },
        {
          min: null,
        },
      ),
    );
  if (record.draft?.some((d) => d.part === index))
    out.push(
      draft(
        `${pick.label} draft`,
        "draft",
        { part: pick.label },
        { min: null },
      ),
    );
  out.push(
    draft(
      `${pick.label} envelope`,
      "envelope",
      { part: pick.label },
      {
        size: null,
      },
    ),
  );
  return out;
}

export type Toggles = { overlap: boolean; clearance: boolean; draft: boolean };

/**
 * Faces to colour for failed checks: overlaps red; clearances, embed walls and draft amber.
 * A part-level failure colours every face of the part, except the largest part of an overlap and
 * the host of an embed, which would hide the part that matters.
 */
export function overlayTones(
  record: InspectRecord,
  results: CheckResult[],
  checks: Check[],
  toggles: Toggles,
): { fail: number[]; warn: number[] } {
  const kind = new Map(checks.map((c) => [c.id, c.kind]));
  const fail = new Set<number>();
  const warn = new Set<number>();
  const facesOf = (r: CheckResult) => [
    ...(r.faces ?? []),
    ...record.faces
      .filter((f) => r.parts?.includes(f.part))
      .map((f) => f.index),
  ];
  for (let r of results) {
    if (r.status !== "fail") continue;
    const k = kind.get(r.id);
    const overlap =
      k === "no_overlap" ||
      (k === "clearance" && r.reason === "The parts overlap");
    // An embed wall colours the embedded part only; its host would hide it.
    if (k === "embed_wall" && r.parts) r = { ...r, parts: r.parts.slice(0, 1) };
    // An overlap colours the intruding parts; the largest part would hide them.
    if (overlap && r.parts && r.parts.length > 1) {
      const largest = r.parts.reduce((a, b) =>
        (record.parts[b]?.volume ?? 0) > (record.parts[a]?.volume ?? 0) ? b : a,
      );
      r = { ...r, parts: r.parts.filter((p) => p !== largest) };
    }
    if (overlap && toggles.overlap) facesOf(r).forEach((f) => fail.add(f));
    else if (
      !overlap &&
      ((k === "clearance" && toggles.clearance) ||
        (k === "embed_wall" && toggles.clearance) ||
        (k === "draft" && toggles.draft))
    )
      facesOf(r).forEach((f) => warn.add(f));
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { fail: sorted(fail), warn: sorted(warn) };
}

const mm = (v: number) => `${v.toFixed(2)} mm`;
export function valueText(value: number, unit?: CheckResult["unit"]) {
  if (unit === "deg") return `${value.toFixed(1)}°`;
  if (unit === "mm³") return `${value.toFixed(2)} mm³`;
  return mm(value);
}

/** The measured value, and what changed since the previous revision when it did. */
export function resultText(
  result: CheckResult,
  previous?: { revision: number; status: string; value?: number },
  revision?: number,
): { value?: string; change?: string } {
  const out: { value?: string; change?: string } = {};
  if (result.value !== undefined)
    out.value = valueText(result.value, result.unit);
  if (
    previous &&
    revision !== undefined &&
    previous.value !== undefined &&
    result.value !== undefined &&
    Math.abs(previous.value - result.value) > 1e-6
  )
    out.change = `${valueText(previous.value, result.unit)} in rev ${previous.revision} → ${out.value} in rev ${revision}`;
  return out;
}

const TBD = "TBD: confirm with your maker";
const set = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A check's limit in words, or TBD when nobody has entered it. */
export function limitText(check: Check): string {
  const l = check.limit ?? {};
  const deg = check.kind === "stability" || check.kind === "draft";
  const one = (v: number) => (deg ? `${v.toFixed(1)}°` : mm(v));
  switch (check.kind) {
    case "no_overlap":
      return "≤ 0.001 mm³";
    case "dimension":
      return set(l.nominal)
        ? `${l.nominal.toFixed(2)} ± ${(set(l.tolerance) ? l.tolerance : 0).toFixed(2)} mm`
        : TBD;
    case "envelope":
      return l.size?.every(set)
        ? `≤ ${l.size.map((v) => v.toFixed(2)).join(" × ")} mm`
        : TBD;
    case "hole":
      if (set(l.min) && set(l.max))
        return `${l.min.toFixed(2)}–${l.max.toFixed(2)} mm`;
      if (set(l.min)) return `≥ ${mm(l.min)}`;
      if (set(l.max)) return `≤ ${mm(l.max)}`;
      return TBD;
    default:
      return set(l.min) ? `≥ ${one(l.min)}` : TBD;
  }
}
