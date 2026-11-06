import { z } from "zod";
import { AppError, id, revisionAccess, type Context } from "./core";
import { define, type Tool } from "./tool-kit";

/** Tools that read a build's exact inspection record. */
const SECTIONS = [
  "parts",
  "faces",
  "holes",
  "pairs",
  "dimensions",
  "materials",
  "embeds",
  "stability",
  "warnings",
] as const;

/** A build's inspection record, after checking the caller may read its revision. */
export async function loadRecord(c: Context, jobId: string) {
  const job = await c.env.DB.prepare(
    "SELECT jobs.revision_id,artifacts.object_key FROM jobs JOIN artifacts ON artifacts.job_id=jobs.id AND artifacts.name='inspect.json' WHERE jobs.id=?",
  )
    .bind(jobId)
    .first<{ revision_id: string; object_key: string }>();
  if (!job) throw new AppError(404, "This build has no inspection record");
  const revision = await revisionAccess(c, job.revision_id, "read");
  const object = await c.env.ARTIFACTS.get(job.object_key);
  if (!object) throw new AppError(404, "Inspection record missing");
  return { record: (await object.json()) as Record<string, unknown>, revision };
}

export const inspectTools: Tool[] = [
  define(
    "inspect_get",
    "Read a build's exact measurements from OCCT: parts (volume, area, bounding box, centre of mass), faces (type, area, normal, diameter or radius, thickness through the part), holes (diameter, depth, through), part pairs (minimum distance, overlap volume), declared dimensions with their measured values, materials, embeds (contained, wall to the outside) and stability (centre of mass, footprint, tip angle). Ask for sections, parts or faces to keep the result small.",
    {
      jobId: id,
      sections: z.array(z.enum(SECTIONS)).max(SECTIONS.length).optional(),
      parts: z.array(z.number().int().nonnegative()).max(500).optional(),
      faces: z.array(z.number().int().nonnegative()).max(500).optional(),
    },
    true,
    async (c, i) => {
      const { record } = await loadRecord(c, i.jobId);
      const wanted = new Set<string>(
        i.sections ?? (i.parts || i.faces ? [] : SECTIONS),
      );
      if (i.parts) wanted.add("parts");
      if (i.faces) wanted.add("faces");
      const out: Record<string, unknown> = {};
      for (const key of wanted) out[key] = record[key];
      if (i.parts)
        out.parts = (record.parts as { index: number }[]).filter((p) =>
          i.parts!.includes(p.index),
        );
      if (i.faces)
        out.faces = (record.faces as { index: number }[]).filter((f) =>
          i.faces!.includes(f.index),
        );
      if (!i.sections && !i.parts && !i.faces)
        out.faces_truncated = record.faces_truncated;
      return out;
    },
  ),
];
