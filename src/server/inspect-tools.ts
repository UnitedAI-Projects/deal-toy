import { z } from "zod";
import { notify, recordEvent, sessionFor } from "./activity";
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
    "view_highlight",
    "Point at faces (by inspect index) or parts (by label) in the viewers of people watching this project, with a short message saying why. Use it when you talk about a measurement so the team sees what you mean. It changes nothing in the model.",
    {
      sessionId: id,
      jobId: id,
      faces: z.array(z.number().int().nonnegative()).max(50).optional(),
      parts: z.array(z.string().max(120)).max(50).optional(),
      message: z.string().trim().max(500).optional(),
    },
    false,
    async (c, i) => {
      const session = await sessionFor(c, i.sessionId!);
      const { record, revision } = await loadRecord(c, i.jobId);
      if (revision.project_id !== session.project_id)
        throw new AppError(400, "Session belongs to another project");
      // Only someone who may change the project points at things in its viewers.
      await revisionAccess(c, revision.id, "write");
      const faces = i.faces ?? [];
      const parts = i.parts ?? [];
      const known = record.faces as { index: number }[];
      for (const f of faces)
        if (!known.some((k) => k.index === f))
          throw new AppError(400, `No face ${f} in this build`);
      const labels = (record.parts as { label: string }[]).map((p) => p.label);
      for (const label of parts)
        if (!labels.includes(label))
          throw new AppError(400, `No part "${label}" in this build`);
      await notify(c.env, revision.project_id, {
        type: "highlight",
        jobId: i.jobId,
        faces,
        parts,
        message: i.message ?? "",
      });
      if (i.message)
        await recordEvent(c, {
          projectId: revision.project_id,
          sessionId: session.id,
          kind: "agent_update",
          payload: { message: i.message },
        });
      return { ok: true, faces: faces.length, parts: parts.length };
    },
  ),
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
