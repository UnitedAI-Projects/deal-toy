/** The build's exact inspection record (inspect.json), shared by the Worker and the viewer. */
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
/**
 * A declared dimension: the distance between two faces, or a placement, whose value is a joint's
 * position (mm) or angle (deg). A missing unit means mm.
 */
export type DimensionRecord = {
  name: string;
  param?: string;
  value: number;
  faces?: [number, number];
  moves?: number;
  joint?: number;
  unit?: "mm" | "deg";
  matches_param: boolean;
  scale: number;
};
/**
 * How one part attaches to another: `part` moves relative to `to`. `origin` and `axis` are the
 * joint's frame on `to` at build time; `value` is its position (mm) or angle (deg) in this build.
 */
export type JointRecord = {
  name: string;
  kind: "rigid" | "linear" | "revolute";
  part: number;
  to: number;
  origin: Vec3;
  axis: Vec3;
  range: [number, number | null];
  value: number;
  unit: "mm" | "deg";
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
export type DraftRecord = {
  part: number;
  pull: Vec3;
  faces: { index: number; angle_deg: number; sampled: boolean }[];
};
/** One line of deal text, worded exactly as the model cut or declared it. */
export type LetteringRecord = {
  text: string;
  name?: string;
  part?: string;
  font?: string;
  method?: string;
  height?: number;
  depth?: number;
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
  lettering?: LetteringRecord[];
  embeds?: EmbedRecord[];
  stability?: StabilityRecord | null;
  draft?: DraftRecord[];
  joints?: JointRecord[];
  faces_truncated: boolean;
};
