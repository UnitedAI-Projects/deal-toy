/** The build's exact inspection record (inspect.json) and the pure functions the viewer uses with it. */
export type Vec3 = [number, number, number];
export type Box = { min: Vec3; max: Vec3 };
export type PartRecord = {
  index: number;
  label: string;
  volume: number;
  area: number;
  bbox: Box;
  center_of_mass: Vec3;
};
export type FaceRecord = {
  index: number;
  part: number;
  type: "plane" | "cylinder" | "cone" | "sphere" | "torus" | "other";
  area: number;
  center: Vec3;
  bbox: Box;
  plane?: { origin: Vec3; normal: Vec3 };
  cylinder?: { origin: Vec3; axis: Vec3; radius: number };
  cone?: { origin: Vec3; axis: Vec3; half_angle_deg: number };
  sphere?: { center: Vec3; radius: number };
  torus?: { major: number; minor: number };
  thickness?: number;
  /** Names that steps created for this face, in step order, and the part sides it is. */
  names?: { of: string; name: string }[];
  sides?: string[];
};
export type HoleRecord = {
  part: number;
  faces: number[];
  diameter: number;
  axis: { origin: Vec3; direction: Vec3 };
  depth: number;
  through: boolean;
};
export type PairRecord = {
  a: number;
  b: number;
  distance: number;
  overlap_volume: number;
};
export type DimensionRecord = {
  name: string;
  param?: string;
  value: number;
  faces: [number, number];
  moves?: number;
  matches_param: boolean;
  scale: number;
};
export type EmbedRecord = {
  part: number;
  in: number;
  contained: boolean;
  wall: number;
};
export type StabilityRecord = {
  center_of_mass: Vec3;
  uniform_density: boolean;
  footprint: [number, number][];
  tip_angle_deg: number;
  tip_direction: [number, number];
};
export type InspectRecord = {
  version: 1;
  units: "mm";
  warnings: string[];
  parts: PartRecord[];
  faces: FaceRecord[];
  holes: HoleRecord[];
  pairs?: PairRecord[];
  dimensions?: DimensionRecord[];
  materials?: Record<string, { name: string; density_g_cm3: number }>;
  embeds?: EmbedRecord[];
  stability?: StabilityRecord | null;
  faces_truncated: boolean;
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

function boxDistance(box: Box, p: Vec3, grow = 0) {
  const d = [0, 1, 2].map((k) =>
    Math.max(box.min[k] - grow - p[k], 0, p[k] - box.max[k] - grow),
  );
  return Math.hypot(d[0], d[1], d[2]);
}

/** Distance from a point to a face's surface: exact for planes, cylinders and spheres. */
export function surfaceDistance(face: FaceRecord, p: Vec3): number {
  if (face.plane)
    return Math.abs(dot(face.plane.normal, sub(p, face.plane.origin)));
  if (face.cylinder) {
    const { origin, axis, radius } = face.cylinder;
    const v = sub(p, origin);
    const along = dot(v, axis) / length(axis);
    return Math.abs(Math.sqrt(Math.max(0, dot(v, v) - along * along)) - radius);
  }
  if (face.sphere)
    return Math.abs(length(sub(p, face.sphere.center)) - face.sphere.radius);
  return boxDistance(face.bbox, p);
}

/**
 * The face of a part under a hit point (model coordinates, mm). Faces whose box, grown by 0.1 mm,
 * contains the point compete on exact surface distance; ties go to the lower index.
 */
export function pickFace(
  record: InspectRecord,
  partLabel: string,
  hit: Vec3,
): number | null {
  if (record.faces_truncated) return null;
  const part = record.parts.find((p) => p.label === partLabel);
  if (!part) return null;
  const faces = record.faces.filter((f) => f.part === part.index);
  if (!faces.length) return null;
  const near = faces.filter((f) => boxDistance(f.bbox, hit, 0.1) === 0);
  const candidates = near.length ? near : faces;
  let best = candidates[0];
  let bestScore = near.length
    ? surfaceDistance(best, hit)
    : boxDistance(best.bbox, hit);
  for (const face of candidates.slice(1)) {
    const score = near.length
      ? surfaceDistance(face, hit)
      : boxDistance(face.bbox, hit);
    if (
      score < bestScore - 1e-9 ||
      (Math.abs(score - bestScore) <= 1e-9 && face.index < best.index)
    ) {
      best = face;
      bestScore = score;
    }
  }
  return best.index;
}

/**
 * OCCT exports glTF Y up: model (x, y, z) in mm becomes (x, z, -y) times the export's unit scale.
 * `scale` is scene units per millimetre.
 */
export function toScene(p: Vec3, scale: number): Vec3 {
  return [p[0] * scale, p[2] * scale, -p[1] * scale];
}
export function toModel(p: Vec3, scale: number): Vec3 {
  return [p[0] / scale, -p[2] / scale, p[1] / scale];
}

/** Scene units per millimetre, from the record's overall size and the loaded mesh's size. */
export function sceneScale(record: InspectRecord, sceneSize: Vec3): number {
  if (!record.parts.length) return 1;
  const min = [0, 1, 2].map((k) =>
    Math.min(...record.parts.map((p) => p.bbox.min[k])),
  );
  const max = [0, 1, 2].map((k) =>
    Math.max(...record.parts.map((p) => p.bbox.max[k])),
  );
  const modelSize = length([max[0] - min[0], max[1] - min[1], max[2] - min[2]]);
  return modelSize > 0 ? length(sceneSize) / modelSize : 1;
}

export type Selection = { kind: "face" | "part"; index: number };
const mm = (v: number) => `${v.toFixed(2)} mm`;
const vector = (v: Vec3) => `(${v.map((x) => +x.toFixed(3) || 0).join(", ")})`;

/** What the inspect panel shows for one face; every value comes from the exact record. */
export function faceSummary(
  record: InspectRecord,
  index: number,
): { title: string; rows: [string, string][] } {
  const face = record.faces[index];
  const part = record.parts[face.part]?.label ?? "";
  const hole = record.holes.find((h) => h.faces.includes(index));
  const rows: [string, string][] = [
    ["Part", part],
    ["Area", `${face.area.toFixed(2)} mm²`],
  ];
  let title = "Curved face";
  if (face.plane) {
    title = "Flat face";
    rows.push(["Normal", vector(face.plane.normal)]);
    if (face.thickness !== undefined)
      rows.push(["Thickness", mm(face.thickness)]);
  } else if (face.cylinder) {
    if (hole) {
      title = `Hole Ø${hole.diameter.toFixed(2)} mm`;
      rows.push(
        ["Diameter", mm(hole.diameter)],
        ["Depth", `${mm(hole.depth)}, ${hole.through ? "through" : "blind"}`],
      );
    } else {
      title = `Rounded face R${face.cylinder.radius.toFixed(2)} mm`;
      rows.push(
        ["Radius", mm(face.cylinder.radius)],
        ["Axis", vector(face.cylinder.axis)],
      );
    }
  } else if (face.sphere) {
    title = `Spherical face R${face.sphere.radius.toFixed(2)} mm`;
    rows.push(["Radius", mm(face.sphere.radius)]);
  } else if (face.cone) {
    title = "Conical face";
    rows.push(["Half angle", `${face.cone.half_angle_deg.toFixed(1)}°`]);
  } else if (face.torus) {
    title = `Rounded face R${face.torus.minor.toFixed(2)} mm`;
    rows.push(["Radius", mm(face.torus.minor)]);
  }
  return { title, rows };
}

/** The exact measurement between two selections, or why it is not available from the record. */
export function measureBetween(
  record: InspectRecord,
  a: Selection,
  b: Selection,
): { label: string; value: string } | { label: string; unavailable: string } {
  if (a.kind === "part" && b.kind === "part") {
    const [i, j] = a.index < b.index ? [a.index, b.index] : [b.index, a.index];
    const label = `Gap between ${record.parts[i]?.label} and ${record.parts[j]?.label}`;
    const pair = record.pairs?.find((p) => p.a === i && p.b === j);
    if (!pair)
      return {
        label,
        unavailable: "Not measured: only the first 30 parts are paired",
      };
    const overlap =
      pair.overlap_volume > 0
        ? `, overlapping by ${pair.overlap_volume.toFixed(2)} mm³`
        : "";
    return { label, value: `${mm(pair.distance)}${overlap}` };
  }
  if (a.kind === "face" && b.kind === "face") {
    const fa = record.faces[a.index];
    const fb = record.faces[b.index];
    if (
      fa.plane &&
      fb.plane &&
      Math.abs(Math.abs(dot(fa.plane.normal, fb.plane.normal)) - 1) < 1e-9
    )
      return {
        label: "Distance between the faces",
        value: mm(
          Math.abs(dot(fa.plane.normal, sub(fb.plane.origin, fa.plane.origin))),
        ),
      };
    if (fa.cylinder && fb.cylinder) {
      const axis = fa.cylinder.axis;
      const offset = sub(fb.cylinder.origin, fa.cylinder.origin);
      const along = dot(offset, axis) / length(axis);
      const coaxial =
        Math.abs(
          Math.abs(dot(axis, fb.cylinder.axis)) /
            (length(axis) * length(fb.cylinder.axis)) -
            1,
        ) < 1e-9 &&
        Math.sqrt(Math.max(0, dot(offset, offset) - along * along)) < 1e-6;
      if (coaxial)
        return {
          label: "Radial gap",
          value: mm(Math.abs(fa.cylinder.radius - fb.cylinder.radius)),
        };
    }
  }
  return {
    label: "Between these faces",
    unavailable: "Needs an exact measure, which comes with checks",
  };
}
