import type { FaceRecord, InspectRecord, Vec3 } from "./inspect";

/** Approximate geometry for an action being filled in, drawn until the real build arrives. */
export type Ghost =
  | { kind: "plane"; origin: Vec3; normal: Vec3; size: number }
  | {
      kind: "cylinder";
      origin: Vec3;
      axis: Vec3;
      radius: number;
      length: number;
    }
  | {
      kind: "prism";
      origin: Vec3;
      normal: Vec3;
      width: number;
      length: number;
      depth: number;
    }
  | { kind: "box"; min: Vec3; max: Vec3 };

type Values = Record<string, unknown>;
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [
  a[0] + b[0] * k,
  a[1] + b[1] * k,
  a[2] + b[2] * k,
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const clean = (a: Vec3): Vec3 =>
  a.map((v) => (Math.abs(v) < 1e-12 ? 0 : v)) as Vec3;

/** The face a reference points at in this build, as the engine would resolve it (or null). */
export function resolveFace(
  record: InspectRecord,
  ref: unknown,
): FaceRecord | null {
  const r = ref as Record<string, unknown> | undefined;
  if (!r || r.ref !== "face") return null;
  if (typeof r.name === "string") {
    const named = record.faces.find((f) =>
      f.names?.some((n) => n.of === r.of && n.name === r.name),
    );
    if (named) return named;
    const part = record.parts.find((p) => p.label === r.of);
    return (
      record.faces.find(
        (f) => f.part === part?.index && f.sides?.includes(r.name as string),
      ) ?? null
    );
  }
  const part = record.parts.find((p) => p.label === r.of);
  const normal = r.normal as Vec3;
  const near = r.near as Vec3;
  const candidates = record.faces.filter(
    (f) =>
      f.part === part?.index &&
      f.plane &&
      dot(f.plane.normal, normal) > Math.cos(Math.PI / 180),
  );
  const distance = (f: FaceRecord) => Math.hypot(...add(f.center, near, -1));
  return candidates.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}

const number = (
  value: unknown,
  params: Record<string, number>,
): number | null =>
  typeof value === "number"
    ? value
    : value && typeof value === "object" && "param" in value
      ? (params[(value as { param: string }).param] ?? null)
      : null;

/** Where a point lands on a flat face: its projection onto the face's plane, or the face centre. */
function onFace(face: FaceRecord, at: unknown): Vec3 {
  if (!Array.isArray(at) || !face.plane) return face.center;
  const p = at as Vec3;
  const n = face.plane.normal;
  return clean(add(p, n, -dot(add(p, face.plane.origin, -1), n)));
}

/** How far a part extends behind a face, along the face's inward normal. */
function depthThrough(record: InspectRecord, face: FaceRecord): number {
  const box = record.parts[face.part].bbox;
  const n = face.plane!.normal;
  const corners = [0, 1].flatMap((i) =>
    [0, 1].flatMap((j) =>
      [0, 1].map((k): Vec3 => [
        i ? box.max[0] : box.min[0],
        j ? box.max[1] : box.min[1],
        k ? box.max[2] : box.min[2],
      ]),
    ),
  );
  const ts = corners.map((c) => dot(add(c, face.plane!.origin, -1), neg(n)));
  return Math.max(...ts);
}

export function ghostShape(
  action: string,
  values: Values,
  record: InspectRecord,
  params: Record<string, number>,
): Ghost | null {
  if (action === "hole") {
    const face = resolveFace(record, values.on);
    const diameter = number(values.diameter, params);
    if (!face?.plane || diameter === null) return null;
    const length =
      values.extent === "through"
        ? depthThrough(record, face)
        : number(values.depth, params);
    if (length === null) return null;
    return {
      kind: "cylinder",
      origin: onFace(face, values.at),
      axis: clean(neg(face.plane.normal)),
      radius: diameter / 2,
      length,
    };
  }
  if (action === "plane" && values.method === "offset") {
    const face = resolveFace(record, values.reference);
    if (!face?.plane) return null;
    const distance = number(values.distance ?? 0, params) ?? 0;
    return {
      kind: "plane",
      origin: clean(add(face.center, face.plane.normal, distance)),
      normal: face.plane.normal,
      size: Math.sqrt(face.area),
    };
  }
  if (action === "body") {
    const size = values.size as unknown[] | undefined;
    const dims =
      (values.shape === "box" || values.shape === "rounded_box") &&
      Array.isArray(size)
        ? size.map((v) => number(v, params))
        : values.shape === "cylinder"
          ? [
              number(values.diameter, params),
              number(values.diameter, params),
              number(values.height, params),
            ]
          : null;
    if (!dims || dims.some((d) => d === null)) return null;
    const [w, l, h] = dims as number[];
    const face = resolveFace(record, values.on);
    if (face?.plane)
      return {
        kind: "prism",
        origin: onFace(face, values.at),
        normal: face.plane.normal,
        width: w,
        length: l,
        depth: h,
      };
    const at = (Array.isArray(values.at) ? values.at : [0, 0, 0]) as Vec3;
    return {
      kind: "box",
      min: [at[0] - w / 2, at[1] - l / 2, at[2]],
      max: [at[0] + w / 2, at[1] + l / 2, at[2] + h],
    };
  }
  if (action === "extrude") {
    const face = resolveFace(record, values.on);
    const distance = number(values.distance, params);
    if (!face?.plane || distance === null || distance === 0) return null;
    const round = values.profile === "circle" || values.profile === "polygon";
    const width = number(round ? values.diameter : values.width, params);
    const length = number(round ? values.diameter : values.length, params);
    if (width === null || length === null) return null;
    const normal =
      distance > 0 ? face.plane.normal : clean(neg(face.plane.normal));
    return {
      kind: "prism",
      origin: onFace(face, values.at),
      normal,
      width,
      length,
      depth: Math.abs(distance),
    };
  }
  return null;
}
