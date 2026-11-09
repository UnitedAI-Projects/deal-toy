/**
 * How parts move in the viewer: exploded apart along their joints, or posed at another joint value.
 * Pure math on the inspection record, in the model frame (mm); nothing here is saved. Matrices are
 * 4×4, column-major like three.js.
 */
import type { InspectRecord, JointRecord, Vec3 } from "../shared/inspect-types";
import type { ParamRange } from "./adjust";

export type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 | null => {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : null;
};

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return out;
}

function translation(v: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
}

/** A right-handed rotation by `degrees` about the line through `origin` along `axis`. */
function rotationAbout(origin: Vec3, axis: Vec3, degrees: number): Mat4 {
  const [x, y, z] = unit(axis) ?? [0, 0, 1];
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = 1 - c;
  const r: Mat4 = [
    c + x * x * k,
    y * x * k + z * s,
    z * x * k - y * s,
    0,
    x * y * k - z * s,
    c + y * y * k,
    z * y * k + x * s,
    0,
    x * z * k + y * s,
    y * z * k - x * s,
    c + z * z * k,
    0,
    0,
    0,
    0,
    1,
  ];
  return multiply(
    translation(origin),
    multiply(r, translation(scale(origin, -1))),
  );
}

export function applyPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** The inverse of a rotation-and-translation matrix. */
export function invertRigid(m: Mat4): Mat4 {
  const t: Vec3 = [m[12], m[13], m[14]];
  const out: Mat4 = [
    m[0],
    m[4],
    m[8],
    0,
    m[1],
    m[5],
    m[9],
    0,
    m[2],
    m[6],
    m[10],
    0,
    0,
    0,
    0,
    1,
  ];
  const back = applyPoint(out, t);
  out[12] = -back[0];
  out[13] = -back[1];
  out[14] = -back[2];
  return out;
}

/** The motion that takes a part from its joint's built value to `value`. */
export function jointMotion(joint: JointRecord, value: number): Mat4 {
  const change = value - joint.value;
  if (!Number.isFinite(change) || change === 0) return IDENTITY;
  if (joint.kind === "linear")
    return translation(scale(unit(joint.axis) ?? [0, 0, 0], change));
  if (joint.kind === "revolute")
    return rotationAbout(joint.origin, joint.axis, change);
  return IDENTITY;
}

function assemblyDiagonal(record: InspectRecord) {
  if (!record.parts.length) return 0;
  const min = [0, 1, 2].map((k) =>
    Math.min(...record.parts.map((p) => p.bbox.min[k])),
  );
  const max = [0, 1, 2].map((k) =>
    Math.max(...record.parts.map((p) => p.bbox.max[k])),
  );
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/**
 * Each part's explode offset relative to the part it attaches to, for `amount` from 0 to 1.
 * Linear joints pull along their axis; rigid and revolute ones away from their parent's centre
 * of mass. Without any joints, parts move radially from the assembly's centre of mass, in proportion
 * to their distance from it.
 */
export function explodeOffsets(record: InspectRecord, amount: number): Vec3[] {
  const a = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0));
  const distance = a * 0.5 * assemblyDiagonal(record);
  const out: Vec3[] = record.parts.map(() => [0, 0, 0]);
  if (distance === 0 || record.parts.length < 2) return out;
  const joints = record.joints ?? [];
  const com = (i: number) => record.parts[i].center_of_mass;
  if (!joints.length) {
    const total =
      record.parts.reduce((s, p) => s + Math.max(p.volume, 0), 0) || 1;
    const centre = record.parts.reduce<Vec3>(
      (s, p) =>
        [0, 1, 2].map(
          (k) => s[k] + (p.center_of_mass[k] * Math.max(p.volume, 0)) / total,
        ) as Vec3,
      [0, 0, 0],
    );
    // Offsets grow with each part's distance from the centre, so parts on one line still separate.
    const radii = record.parts.map((p) => sub(p.center_of_mass, centre));
    const farthest = Math.max(...radii.map(length));
    radii.forEach((r, i) => {
      out[i] =
        farthest > 1e-9 && length(r) > 1e-9
          ? scale(r, distance / farthest)
          : [0, 0, distance];
    });
    return out;
  }
  for (const j of joints) {
    const direction =
      j.kind === "linear"
        ? unit(j.axis)
        : (unit(sub(com(j.part), com(j.to))) ?? unit(j.axis));
    out[j.part] = scale(direction ?? [0, 0, 1], distance);
  }
  return out;
}

/**
 * Every part's transform from its built position, indexed like `record.parts`: its parent's
 * transform, then its explode offset, then its joint's motion to `poses[jointIndex]`.
 */
export function partTransforms(
  record: InspectRecord,
  explode: number,
  poses: Record<number, number>,
): Mat4[] {
  const offsets = explodeOffsets(record, explode);
  const joints = record.joints ?? [];
  const jointOf = new Map(joints.map((j, k) => [j.part, k]));
  const done = new Map<number, Mat4>();
  const visit = (part: number, seen: Set<number>): Mat4 => {
    const known = done.get(part);
    if (known) return known;
    const k = jointOf.get(part);
    let m = IDENTITY;
    if (k !== undefined && !seen.has(part)) {
      const joint = joints[k];
      seen.add(part);
      const parent = joint.to === part ? IDENTITY : visit(joint.to, seen);
      const motion = k in poses ? jointMotion(joint, poses[k]) : IDENTITY;
      m = multiply(parent, multiply(translation(offsets[part]), motion));
    } else if (!record.joints?.length) {
      m = translation(offsets[part]);
    }
    done.set(part, m);
    return m;
  };
  return record.parts.map((_, i) => visit(i, new Set()));
}

/**
 * The signed angle in degrees, right-handed about the axis and measured from `ref`, at which a
 * pointer ray meets the plane through `axisOrigin` across the axis. Null when the ray runs along
 * that plane or meets it on the axis.
 */
export function angleAround(
  rayOrigin: Vec3,
  rayDir: Vec3,
  axisOrigin: Vec3,
  axisDir: Vec3,
  ref: Vec3,
): number | null {
  const a = unit(axisDir);
  const d = unit(rayDir);
  if (!a || !d || Math.abs(dot(d, a)) < 1e-6) return null;
  const t = dot(sub(axisOrigin, rayOrigin), a) / dot(d, a);
  const hit: Vec3 = [
    rayOrigin[0] + d[0] * t,
    rayOrigin[1] + d[1] * t,
    rayOrigin[2] + d[2] * t,
  ];
  const v = sub(hit, axisOrigin);
  const radial = sub(v, scale(a, dot(v, a)));
  if (length(radial) < 1e-9) return null;
  const r =
    unit(sub(ref, scale(a, dot(ref, a)))) ??
    unit(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))!;
  const s = cross(a, r);
  return (Math.atan2(dot(radial, s), dot(radial, r)) * 180) / Math.PI;
}

/**
 * A joint's value after a drag of `delta` (mm or degrees) from `start`: snapped to 0.1 mm or 1°,
 * then kept within the joint's range and the driving parameter's range times its scale.
 */
export function jointDragValue(
  joint: JointRecord,
  spec: (ParamRange & { scale?: number }) | undefined,
  start: number,
  delta: number,
): number {
  if (!Number.isFinite(delta) || !Number.isFinite(start)) return start;
  const step = joint.unit === "deg" ? 1 : 0.1;
  let value = Math.round((start + delta) / step) * step;
  const [low, high] = joint.range;
  value = Math.max(value, low);
  if (high !== null) value = Math.min(value, high);
  const k = spec?.scale || 1;
  if (spec?.min !== undefined) value = Math.max(value, spec.min * k);
  if (spec?.max !== undefined) value = Math.min(value, spec.max * k);
  return Math.round(value * 1e6) / 1e6;
}
