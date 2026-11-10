import { z } from "zod";
import { notify, recordEvent, sessionFor } from "./activity";
import { isRef } from "./actions/validate";
import {
  AppError,
  id,
  modelAccess,
  revisionAccess,
  type Context,
} from "./core";
import { now } from "./tool-kit";
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
  "joints",
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
    "selection_set",
    "Record what you have selected in a model's viewer (up to 4 references), so the agent's model summary can name it. An empty list clears it.",
    { modelId: id, refs: z.array(z.unknown()).max(4) },
    false,
    async (c, i) => {
      await modelAccess(c, i.modelId, "read");
      for (const ref of i.refs)
        if (
          !["face", "edges", "datum", "part", "point"].some((kind) =>
            isRef(kind, ref),
          )
        )
          throw new AppError(400, "A selection item is not a reference");
      if (!i.refs.length)
        await c.env.DB.prepare(
          "DELETE FROM selections WHERE model_id=? AND member=?",
        )
          .bind(i.modelId, c.identity.email)
          .run();
      else
        await c.env.DB.prepare(
          "INSERT INTO selections VALUES (?,?,?,?) ON CONFLICT(model_id,member) DO UPDATE SET refs=excluded.refs,updated_at=excluded.updated_at",
        )
          .bind(i.modelId, c.identity.email, JSON.stringify(i.refs), now())
          .run();
      return { ok: true, count: i.refs.length };
    },
  ),
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
    "Read a build's exact measurements from OCCT: parts (volume, area, bounding box, centre of mass), faces (type, area, normal, diameter or radius, thickness through the part), holes (diameter, depth, through), part pairs (minimum distance, overlap volume), declared dimensions with their measured values (including placements, whose value is a joint's position in mm or angle in degrees), materials, embeds (contained, wall to the outside), stability (centre of mass, footprint, tip angle) and joints (which part moves relative to which: rigid, linear or revolute, with axis, range and current value). Set a placement with models_set_parameter. Ask for sections, parts or faces to keep the result small.",
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
      if (i.parts) wanted.add("parts").add("joints");
      if (i.faces) wanted.add("faces");
      const out: Record<string, unknown> = {};
      for (const key of wanted) out[key] = record[key];
      if (i.parts)
        out.parts = (record.parts as { index: number }[]).filter((p) =>
          i.parts!.includes(p.index),
        );
      if (i.parts && Array.isArray(record.joints))
        out.joints = (record.joints as { part: number; to: number }[]).filter(
          (j) => i.parts!.includes(j.part) || i.parts!.includes(j.to),
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
