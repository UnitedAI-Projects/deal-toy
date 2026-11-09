import type { FaceTarget } from "../../shared/checks";
import type {
  FaceRecord,
  InspectRecord,
  Vec3,
} from "../../shared/inspect-types";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A face's direction for matching: plane normal, cylinder or cone axis, else zeros. */
export function directionOf(face: FaceRecord): Vec3 {
  return (
    face.plane?.normal ?? face.cylinder?.axis ?? face.cone?.axis ?? [0, 0, 0]
  );
}

/** Same direction within 1°. Axes match either way round; plane normals must agree in sign. */
function sameDirection(face: FaceRecord, want: Vec3): boolean {
  const have = directionOf(face);
  if (!dot(want, want)) return !dot(have, have);
  const cos = dot(have, want) / Math.hypot(...have) / Math.hypot(...want);
  return (face.plane ? cos : Math.abs(cos)) > Math.cos(Math.PI / 180);
}

/** A face may move this far between builds and still be found by its signature. */
const MAX_MOVE = 10;
/** And its area may change this much. */
const AREA_CHANGE = 0.25;

export type LabelLookup = { index: number } | { unknown: string };

/** A part by label, refusing labels that are missing or shared by two parts. */
export function partIndex(record: InspectRecord, label: string): LabelLookup {
  const matches = record.parts.filter((p) => p.label === label);
  if (matches.length > 1)
    return { unknown: `Two parts are labelled "${label}"` };
  if (!matches.length) return { unknown: `No part "${label}" in this build` };
  return { index: matches[0].index };
}

/**
 * The face a check means in this build. A step-created name or a part side wins. Otherwise the
 * signature: same part, type and direction, area within 25%, the nearest centre within 10 mm,
 * and clearly nearer than any other candidate. Anything less is "re-pick needed", never a guess.
 */
export function resolveFace(
  record: InspectRecord,
  target: FaceTarget,
): LabelLookup {
  if (record.faces_truncated)
    return { unknown: "Not measured: the model has over 20,000 faces" };
  const ref = target.ref as { of?: unknown; name?: unknown } | undefined;
  if (ref && typeof ref.of === "string" && typeof ref.name === "string") {
    const named = record.faces.find((f) =>
      f.names?.some((n) => n.of === ref.of && n.name === ref.name),
    );
    if (named) return { index: named.index };
    const part = record.parts.filter((p) => p.label === ref.of);
    if (part.length === 1) {
      const side = record.faces.find(
        (f) =>
          f.part === part[0].index && f.sides?.includes(ref.name as string),
      );
      if (side) return { index: side.index };
    }
  }
  const sig = target.signature;
  const part = partIndex(record, sig.part);
  if ("unknown" in part) return part;
  const candidates = record.faces
    .filter(
      (f) =>
        f.part === part.index &&
        f.type === sig.type &&
        sameDirection(f, sig.direction) &&
        Math.abs(f.area - sig.area) <= AREA_CHANGE * sig.area,
    )
    .map((f) => ({ f, d: distance(f.center, sig.center) }))
    .sort((a, b) => a.d - b.d || a.f.index - b.f.index);
  const [first, second] = candidates;
  if (!first || first.d > MAX_MOVE)
    return { unknown: "Re-pick needed: the face is gone" };
  if (second && second.d <= 2 * first.d + 0.5)
    return { unknown: "Re-pick needed: more than one face matches" };
  return { index: first.f.index };
}
