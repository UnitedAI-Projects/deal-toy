/* A project's recorded demo: saved by its owner, played back by anyone who may read the project. */
import { z } from "zod";
import { AppError, id, projectAccess } from "./core";
import { PHASES } from "./phase-tools";
import { define, now, type Tool } from "./tool-kit";

const MAX_SCRIPT_BYTES = 2_000_000;
const text = (max: number) => z.string().max(max);
const step = z
  .object({
    phase: z.enum(PHASES),
    kind: z.enum(["agent", "manual", "system", "message"]),
    title: text(120),
    caption: text(800),
    prompt: text(4000).optional(),
    response: text(8000).optional(),
    actions: z
      .array(
        z
          .object({ name: text(80), ok: z.boolean(), detail: text(300) })
          .strict(),
      )
      .max(12)
      .optional(),
    model: text(40).optional(),
    revision: z.number().int().nonnegative(),
    // The phase UI reads it; a snapshot the server itself returned from phases_get.
    state: z.record(z.string(), z.unknown()),
    focus: text(200).optional(),
    select: text(80).optional(),
    view: z.enum(["mantel", "engine"]).optional(),
    ms: z.number().int().min(500).max(60_000).optional(),
  })
  .strict();
export const demoScript = z
  .object({
    version: z.literal(1),
    title: text(120),
    summary: text(1000),
    steps: z.array(step).min(1).max(100),
  })
  .strict();

export const demoTools: Tool[] = [
  define(
    "demo_get",
    "Read a project's recorded demo: the steps its playback walks through. Null when it has none.",
    { projectId: id },
    true,
    async (c, i) => {
      await projectAccess(c, i.projectId, "read");
      const row = await c.env.DB.prepare(
        "SELECT script,updated_at FROM project_demos WHERE project_id=?",
      )
        .bind(i.projectId)
        .first<{ script: string; updated_at: string }>();
      return row
        ? { script: JSON.parse(row.script), updatedAt: row.updated_at }
        : { script: null };
    },
  ),
  define(
    "demo_save",
    "Save (or replace) the recorded demo of a project you own. Playback shows these steps; it never changes the project.",
    { projectId: id, script: demoScript },
    false,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      const script = JSON.stringify(i.script);
      if (new TextEncoder().encode(script).length > MAX_SCRIPT_BYTES)
        throw new AppError(400, "A demo script can be up to 2 MB");
      await c.env.DB.prepare(
        "INSERT INTO project_demos (project_id,script,updated_at) VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET script=excluded.script,updated_at=excluded.updated_at",
      )
        .bind(i.projectId, script, now())
        .run();
      return { steps: i.script.steps.length };
    },
    "models.edit",
  ),
];
