import type { InspectRecord, Vec3 } from "./inspect";

/** A step reference as the steps section writes it (mirrors src/server/actions/script.ts). */
export type Ref =
  | { ref: "face"; of: string; name: string }
  | { ref: "face"; of: string; normal: Vec3; near: Vec3 }
  | { ref: "edges"; of: string; around: string }
  | { ref: "edges"; of: string; between: [string, string] }
  | { ref: "datum"; name: string }
  | { ref: "part"; label: string };

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

/**
 * The most stable reference for a picked face: a name a step created, then a part side, then a
 * query by normal and nearest point. Never a face number, which changes between builds.
 */
export function refFromPick(record: InspectRecord, index: number): Ref {
  const face = record.faces[index];
  const part = record.parts[face.part]?.label ?? "";
  if (face.names?.length)
    return { ref: "face", of: face.names[0].of, name: face.names[0].name };
  if (face.sides?.length) return { ref: "face", of: part, name: face.sides[0] };
  let normal: Vec3 = face.plane?.normal ?? [0, 0, 1];
  if (!face.plane && face.cylinder) {
    // Outward from the axis toward the face centre.
    const { origin, axis } = face.cylinder;
    const v: Vec3 = [
      face.center[0] - origin[0],
      face.center[1] - origin[1],
      face.center[2] - origin[2],
    ];
    const len = Math.hypot(...axis);
    const along = (v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]) / len;
    const radial: Vec3 = [
      v[0] - (axis[0] / len) * along,
      v[1] - (axis[1] / len) * along,
      v[2] - (axis[2] / len) * along,
    ];
    const r = Math.hypot(...radial) || 1;
    normal = [radial[0] / r, radial[1] / r, radial[2] / r];
  }
  return {
    ref: "face",
    of: part,
    normal: normal.map(round) as Vec3,
    near: face.center.map(round) as Vec3,
  };
}
