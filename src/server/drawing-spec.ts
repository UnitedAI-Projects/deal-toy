import type {
  Box,
  FaceRecord,
  HoleRecord,
  InspectRecord,
  LetteringRecord,
} from "../shared/inspect-types";

/** What the blueprint can state beyond its views, all of it measured by the build's inspection. */
export type DrawingDetails = {
  materials: { part: string; name: string; volume?: number; mass?: number }[];
  dimensions: {
    name: string;
    value: number;
    matches: boolean;
    part?: string;
  }[];
  holes: {
    part: string;
    diameter: number;
    depth: number;
    blind: boolean;
    at: [number, number, number];
    axis: [number, number, number];
  }[];
  text: { name: string; bbox: Box }[];
  lettering: LetteringRecord[];
};

const MAX_ROWS = 200;

function union(boxes: Box[]): Box {
  const min = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
  const max = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i])));
  return {
    min: min as Box["min"],
    max: max as Box["max"],
  };
}

/**
 * The inspection lists every concave cylinder, so a rounded inside corner appears beside real holes.
 * A bore spans its full diameter across its axis; a corner's quarter cylinder does not. A hole whose
 * faces are not all in the record, or that runs off the model axes, is kept rather than guessed at.
 */
function isBore(hole: HoleRecord, faces: Map<number, FaceRecord>) {
  const walls = hole.faces.map((index) => faces.get(index));
  if (walls.length === 0 || walls.some((face) => !face)) return true;
  const box = union(walls.map((face) => (face as FaceRecord).bbox));
  return hole.axis.direction.every(
    (component, i) =>
      Math.abs(component) > 1e-6 ||
      box.max[i] - box.min[i] >= hole.diameter * 0.98,
  );
}

/** Text steps name the faces they cut, so each line's extent comes from those faces. */
function textExtents(record: InspectRecord) {
  if (record.faces_truncated) return [];
  const lines = new Map<string, Box[]>();
  for (const face of record.faces)
    for (const { of, name } of face.names ?? [])
      if (name === "text_faces")
        lines.set(of, [...(lines.get(of) ?? []), face.bbox]);
  return [...lines].map(([name, boxes]) => ({ name, bbox: union(boxes) }));
}

/** Reduces an inspection record to the rows the drawing job prints. */
export function drawingDetails(record: InspectRecord): DrawingDetails {
  const faces = new Map(record.faces.map((face) => [face.index, face]));
  const label = (part: number) =>
    record.parts.find((p) => p.index === part)?.label ?? `Part ${part}`;
  return {
    materials: Object.entries(record.materials ?? {})
      .map(([part, material]) => {
        const solid = record.parts.find((p) => p.label === part);
        return {
          part,
          name: material.name,
          ...(solid && {
            volume: solid.volume,
            mass: (solid.volume / 1000) * material.density_g_cm3,
          }),
        };
      })
      .slice(0, MAX_ROWS),
    dimensions: (record.dimensions ?? [])
      .map(({ name, value, matches_param: matches, faces: between }) => {
        const part = between && faces.get(between[0])?.part;
        return {
          name,
          value,
          matches,
          ...(part !== undefined && { part: label(part) }),
        };
      })
      .slice(0, MAX_ROWS),
    holes: record.holes
      .filter((hole) => isBore(hole, faces))
      .sort((a, b) => a.part - b.part || b.diameter - a.diameter)
      .map((hole) => ({
        part: label(hole.part),
        diameter: hole.diameter,
        depth: hole.depth,
        blind: !hole.through,
        at: hole.axis.origin,
        axis: hole.axis.direction,
      }))
      .slice(0, MAX_ROWS),
    text: textExtents(record).slice(0, MAX_ROWS),
    lettering: (record.lettering ?? []).slice(0, MAX_ROWS),
  };
}
