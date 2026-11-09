/**
 * The one check evaluator: a pure function of a build's inspection record, the check list and the
 * build's stored exact measurements. Results are pass, fail or unknown, and unknown always says why.
 */
import {
  measureKey,
  type Check,
  type CheckResult,
  type FaceTarget,
  type Measurement,
  type Target,
} from "../../shared/checks";
import type { InspectRecord, Vec3 } from "../../shared/inspect-types";
import { partIndex, resolveFace } from "./resolve";
export { signatureOf } from "../../shared/checks";

const NOT_SET = "Limit not set (TBD: confirm with your maker)";
const OVERLAP = 0.001;
const set = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

type Outcome = Omit<CheckResult, "id">;
type Extra = Omit<Outcome, "status">;
const unknown = (reason: string, extra: Extra = {}): Outcome => ({
  status: "unknown",
  reason,
  ...extra,
});

/** Pass or fail on a minimum, with near-miss marking within 10% of the limit. */
function atLeast(value: number, min: number, extra: Extra): Outcome {
  const pass = value >= min;
  return {
    status: pass ? "pass" : "fail",
    value,
    ...(pass && value < min * 1.1 ? { near: true } : {}),
    ...extra,
  };
}

function between(
  value: number,
  min: number | null | undefined,
  max: number | null | undefined,
  extra: Extra,
): Outcome {
  if (!set(min) && !set(max)) return unknown(NOT_SET);
  const low = !set(min) || value >= min;
  const high = !set(max) || value <= max;
  const near =
    low &&
    high &&
    ((set(min) && value < min * 1.1) || (set(max) && value > max * 0.9));
  return {
    status: low && high ? "pass" : "fail",
    value,
    ...(near ? { near: true } : {}),
    ...extra,
  };
}

const pairsTruncated = (record: InspectRecord) =>
  record.warnings.some((w) => w.startsWith("Only the first"));

function pairOf(record: InspectRecord, a: number, b: number) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return record.pairs?.find((p) => p.a === lo && p.b === hi);
}

function twoParts(record: InspectRecord, labels: [string, string]) {
  const a = partIndex(record, labels[0]);
  if ("unknown" in a) return a;
  const b = partIndex(record, labels[1]);
  if ("unknown" in b) return b;
  const pair = pairOf(record, a.index, b.index);
  if (!pair)
    return {
      unknown: pairsTruncated(record)
        ? "Not measured: only the first 30 parts are paired"
        : "These parts were not measured against each other",
    };
  return { pair, parts: [a.index, b.index] };
}

function size(box: { min: Vec3; max: Vec3 }): Vec3 {
  return [0, 1, 2].map((k) => box.max[k] - box.min[k]) as Vec3;
}

function evaluateOne(
  record: InspectRecord,
  check: Check,
  measurements: Record<string, Measurement>,
): Outcome {
  const t = check.target as Record<string, unknown>;
  const limit = check.limit ?? {};
  switch (check.kind) {
    case "stability": {
      if (!set(limit.min)) return unknown(NOT_SET);
      const s = record.stability;
      if (!s) return unknown("Not measured: the model has no stability record");
      if (s.uniform_density)
        return unknown("Assumes uniform density: declare every part's density");
      return atLeast(s.tip_angle_deg, limit.min, { unit: "deg" });
    }
    case "embed_wall": {
      if (!set(limit.min)) return unknown(NOT_SET);
      const part = partIndex(record, t.part as string);
      if ("unknown" in part) return unknown(part.unknown);
      const embed = record.embeds?.find((e) => e.part === part.index);
      if (!embed) return unknown(`"${t.part}" is not a declared embed`);
      const extra: Extra = { unit: "mm", parts: [embed.part, embed.in] };
      if (!embed.contained)
        return {
          status: "fail",
          value: embed.wall,
          reason: `Not fully inside "${record.parts[embed.in]?.label}"`,
          ...extra,
        };
      return atLeast(embed.wall, limit.min, extra);
    }
    case "dimension": {
      const dim = record.dimensions?.find((d) => d.name === t.dimension);
      if (!dim) return unknown(`No declared dimension named "${t.dimension}"`);
      if (!set(limit.nominal)) return unknown(NOT_SET);
      const tolerance = set(limit.tolerance) ? limit.tolerance : 0;
      const off = Math.abs(dim.value - limit.nominal);
      const pass = off <= tolerance + 1e-9;
      return {
        status: pass ? "pass" : "fail",
        value: dim.value,
        unit: "mm",
        faces: dim.faces,
        ...(pass && tolerance > 0 && off > 0.9 * tolerance
          ? { near: true }
          : {}),
      };
    }
    case "clearance": {
      if (!set(limit.min)) return unknown(NOT_SET);
      if (Array.isArray(t.parts)) {
        const found = twoParts(record, t.parts as [string, string]);
        if ("unknown" in found) return unknown(found.unknown as string);
        const extra: Extra = { unit: "mm", parts: found.parts };
        if (found.pair.overlap_volume > OVERLAP)
          return {
            status: "fail",
            value: 0,
            reason: "The parts overlap",
            ...extra,
          };
        return atLeast(found.pair.distance, limit.min, extra);
      }
      const [fa, fb] = t.faces as [FaceTarget, FaceTarget];
      const a = resolveFace(record, fa);
      if ("unknown" in a) return unknown(a.unknown);
      const b = resolveFace(record, fb);
      if ("unknown" in b) return unknown(b.unknown);
      return exact(
        { face: a.index },
        { face: b.index },
        measurements,
        (value) =>
          atLeast(value, limit.min!, { unit: "mm", faces: [a.index, b.index] }),
      );
    }
    case "no_overlap": {
      if (Array.isArray(t.parts)) {
        const found = twoParts(record, t.parts as [string, string]);
        if ("unknown" in found) return unknown(found.unknown as string);
        const volume = found.pair.overlap_volume;
        return {
          status: volume <= OVERLAP ? "pass" : "fail",
          value: volume,
          unit: "mm³",
          parts: found.parts,
        };
      }
      const embedded = new Set(
        (record.embeds ?? []).map(
          (e) => `${Math.min(e.part, e.in)}-${Math.max(e.part, e.in)}`,
        ),
      );
      const overlapping = (record.pairs ?? []).filter(
        (p) => p.overlap_volume > OVERLAP && !embedded.has(`${p.a}-${p.b}`),
      );
      const volume = overlapping.reduce((sum, p) => sum + p.overlap_volume, 0);
      const parts = [...new Set(overlapping.flatMap((p) => [p.a, p.b]))].sort(
        (x, y) => x - y,
      );
      if (!overlapping.length && pairsTruncated(record))
        return unknown("Not measured: only the first 30 parts are paired");
      return {
        status: overlapping.length ? "fail" : "pass",
        value: volume,
        unit: "mm³",
        ...(parts.length ? { parts } : {}),
      };
    }
    case "envelope": {
      if (!limit.size || !limit.size.every(set)) return unknown(NOT_SET);
      let box: { min: Vec3; max: Vec3 };
      let parts: number[];
      if (typeof t.part === "string") {
        const part = partIndex(record, t.part);
        if ("unknown" in part) return unknown(part.unknown);
        box = record.parts[part.index].bbox;
        parts = [part.index];
      } else {
        if (!record.parts.length) return unknown("The build has no parts");
        box = {
          min: [0, 1, 2].map((k) =>
            Math.min(...record.parts.map((p) => p.bbox.min[k])),
          ) as Vec3,
          max: [0, 1, 2].map((k) =>
            Math.max(...record.parts.map((p) => p.bbox.max[k])),
          ) as Vec3,
        };
        parts = record.parts.map((p) => p.index);
      }
      const dims = size(box);
      const fits = dims.every((d, k) => d <= limit.size![k] + 1e-9);
      return {
        status: fits ? "pass" : "fail",
        value: Math.max(...dims),
        unit: "mm",
        reason: dims.map((d) => d.toFixed(2)).join(" × ") + " mm",
        parts,
      };
    }
    case "hole": {
      const face = resolveFace(record, t.face as FaceTarget);
      if ("unknown" in face) return unknown(face.unknown);
      const hole = record.holes.find((h) => h.faces.includes(face.index));
      if (!hole) return unknown("The picked face is not a hole");
      return between(hole.diameter, limit.min, limit.max, {
        unit: "mm",
        faces: hole.faces,
      });
    }
    case "draft": {
      if (!set(limit.min)) return unknown(NOT_SET);
      const part = partIndex(record, t.part as string);
      if ("unknown" in part) return unknown(part.unknown);
      if (record.faces_truncated)
        return unknown("Not measured: the model has over 20,000 faces");
      const draft = record.draft?.find((d) => d.part === part.index);
      if (!draft) return unknown(`No pull direction for "${t.part}"`);
      const excepted = new Set(
        (check.exceptions ?? []).flatMap((e) => {
          const r = resolveFace(record, e);
          return "index" in r ? [r.index] : [];
        }),
      );
      const faces = draft.faces.filter((f) => !excepted.has(f.index));
      if (!faces.length)
        return {
          status: "pass",
          unit: "deg",
          reason: "Every face is excepted",
        };
      const low = faces.filter((f) => f.angle_deg < limit.min!);
      const least = Math.min(...faces.map((f) => f.angle_deg));
      return {
        ...atLeast(least, limit.min, { unit: "deg" }),
        ...(low.length ? { faces: low.map((f) => f.index) } : {}),
      };
    }
  }
}

/** Uses a stored exact measurement, or says one is needed or running. */
function exact(
  a: Target,
  b: Target,
  measurements: Record<string, Measurement>,
  judge: (value: number) => Outcome,
): Outcome {
  const key = measureKey(a, b);
  const stored = measurements[key];
  if (stored?.status === "done" && set(stored.value))
    return judge(stored.value);
  if (stored?.status === "queued") return unknown("Measuring…");
  if (stored?.status === "failed")
    return unknown(`Measure failed: ${stored.error ?? "unknown error"}`);
  return unknown("Needs an exact measure", { measure: { key, a, b } });
}

export function evaluateChecks(
  record: InspectRecord,
  checks: Check[],
  measurements: Record<string, Measurement>,
): CheckResult[] {
  return checks.map((check) => ({
    id: check.id,
    ...(check.enabled
      ? evaluateOne(record, check, measurements)
      : unknown("Turned off")),
  }));
}
