/** Adjusting a declared dimension by typing a value (A) or dragging its face (B). */
import type {
  DimensionRecord,
  InspectRecord,
  Vec3,
} from "../shared/inspect-types";

export type ParamRange = { value: number; min?: number; max?: number };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mm = (v: number) => v.toFixed(2);

/** The one parameter edit a typed value makes, or why it cannot be made. */
export function dimensionEdit(
  dim: DimensionRecord,
  params: Record<string, ParamRange>,
  value: number,
): { name: string; value: number } | { error: string } {
  if (!dim.param) return { error: "No parameter drives this dimension" };
  if (!dim.matches_param)
    return {
      error: `The declaration doesn't match ${dim.param}; ask the agent to fix it`,
    };
  const spec = params[dim.param];
  if (!spec) return { error: `${dim.param} is not a parameter of this build` };
  const scale = dim.scale || 1;
  const next = value / scale;
  if (
    !Number.isFinite(next) ||
    (spec.min !== undefined && next < spec.min) ||
    (spec.max !== undefined && next > spec.max)
  )
    return {
      error:
        spec.min !== undefined && spec.max !== undefined
          ? `${dim.name} must be between ${mm(spec.min * scale)} and ${mm(spec.max * scale)} mm`
          : `${dim.name} is outside ${dim.param}'s range`,
    };
  return { name: dim.param, value: Math.round(next * 1e6) / 1e6 };
}

/**
 * The line a drag moves the declared face along: its centre and normal, with the sign that makes
 * moving along the normal grow the dimension. Null when there is nothing safe to drag.
 */
export function dragAxis(
  record: InspectRecord,
  dim: DimensionRecord,
): { origin: Vec3; direction: Vec3; sign: 1 | -1 } | null {
  if (dim.moves === undefined || !dim.param || !dim.matches_param) return null;
  const face = record.faces.find((f) => f.index === dim.moves);
  const other = record.faces.find(
    (f) => f.index === dim.faces.find((i) => i !== dim.moves),
  );
  if (!face?.plane || !other) return null;
  const away = dot(face.plane.normal, sub(face.center, other.center));
  return {
    origin: face.center,
    direction: face.plane.normal,
    sign: away >= 0 ? 1 : -1,
  };
}

/** The dimension's value after dragging `along` mm, snapped to 0.1 mm and kept in range. */
export function dragValue(
  dim: DimensionRecord,
  spec: ParamRange,
  along: number,
  sign: 1 | -1,
): number {
  const scale = dim.scale || 1;
  let value = Math.round((dim.value + sign * along) * 10) / 10;
  if (spec.min !== undefined) value = Math.max(value, spec.min * scale);
  if (spec.max !== undefined) value = Math.min(value, spec.max * scale);
  return Math.round(value * 1e6) / 1e6;
}

/** How far along an axis line the pointer ray passes closest to it, in the axis's units. */
export function alongAxis(
  rayOrigin: Vec3,
  rayDir: Vec3,
  axisOrigin: Vec3,
  axisDir: Vec3,
): number {
  const length = Math.hypot(...axisDir);
  const v = axisDir.map((x) => x / length) as Vec3;
  const w0 = sub(rayOrigin, axisOrigin);
  const a = dot(rayDir, rayDir);
  const b = dot(rayDir, v);
  const c = dot(v, v);
  const d = dot(rayDir, w0);
  const e = dot(v, w0);
  const denominator = a * c - b * b;
  if (Math.abs(denominator) < 1e-12 * a * c) return 0;
  return (a * e - b * d) / denominator;
}
