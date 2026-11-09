/** Saved checks and their results, shared by the Worker (which evaluates them) and the viewer. */
import type { Vec3 } from "./inspect-types";

/** A record face or part, by its index in a build's inspection record. */
export type Target = { face: number } | { part: number };

/** A picked face that a check follows across rebuilds: its step reference, if any, and a signature. */
export type FaceTarget = {
  ref?: Record<string, unknown>;
  signature: {
    part: string;
    type: string;
    /** Plane normal, or cylinder/cone axis; zeros for other surfaces. */
    direction: Vec3;
    center: Vec3;
    area: number;
  };
};

export const CHECK_KINDS = [
  "stability",
  "embed_wall",
  "dimension",
  "clearance",
  "no_overlap",
  "envelope",
  "hole",
  "draft",
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export type CheckTarget =
  | Record<string, never>
  | { part: string }
  | { dimension: string }
  | { parts: [string, string] }
  | { faces: [FaceTarget, FaceTarget] }
  | { all: true }
  | { face: FaceTarget };

/** A null limit is one nobody has set yet ("TBD: confirm with your maker"). */
export type CheckLimit = {
  min?: number | null;
  max?: number | null;
  nominal?: number | null;
  tolerance?: number | null;
  size?: Vec3 | null;
};

export type By = { email: string; agent: boolean };

export type Check = {
  id: string;
  name: string;
  kind: CheckKind;
  enabled: boolean;
  target: CheckTarget;
  limit: CheckLimit;
  exceptions?: FaceTarget[];
  created_by: By;
  created_at: string;
  edited_by: By;
  edited_at: string;
};

export type CheckResult = {
  id: string;
  status: "pass" | "fail" | "unknown";
  value?: number;
  unit?: "mm" | "mm³" | "deg";
  /** Plain words for a person: why it is unknown or failed, or what was measured. */
  reason?: string;
  /** A pass within 10% of its limit. */
  near?: boolean;
  faces?: number[];
  parts?: number[];
  /** Set when an exact measure job would answer this check. */
  measure?: { key: string; a: Target; b: Target };
};

/** A stored exact measurement for one build. */
export type Measurement = {
  status: "queued" | "done" | "failed";
  value?: number;
  error?: string;
};

/** The key a measurement is stored under: the same for (a, b) and (b, a). */
export function measureKey(a: Target, b: Target): string {
  const name = (t: Target) => ("face" in t ? `f${t.face}` : `p${t.part}`);
  return [name(a), name(b)].sort().join("-");
}
