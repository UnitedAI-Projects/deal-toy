import { z } from "zod";
import { requirePermission } from "./access";
import { readSteps } from "./actions/script";
import { AppError, id, revisionAccess } from "./core";
import { define, queueBuild, type Tool } from "./tool-kit";

/** Tools for saved actions, presets and view-as-of previews. */
export const savedTools: Tool[] = [
  define(
    "builds_view_as_of",
    "Show the model as it was after one step: queues (or reuses) a preview build of the revision that runs only the steps up to and including `step`, exporting the viewer mesh and facts. Poll builds_get with the returned id. It writes no revision and counts toward the daily build limit.",
    { revisionId: id, step: z.string().min(1).max(80) },
    true,
    async (c, i) => {
      const revision = await revisionAccess(c, i.revisionId, "read");
      const { steps } = readSteps(revision.source);
      const index = steps.findIndex((s) => s.name === i.step);
      if (index === -1) throw new AppError(404, `No step named "${i.step}"`);
      const stopAfter = index + 1;
      const existing = await c.env.DB.prepare(
        "SELECT id,status FROM jobs WHERE revision_id=? AND purpose='view' AND options=? AND status IN ('queued','running','succeeded') ORDER BY created_at DESC LIMIT 1",
      )
        .bind(i.revisionId, JSON.stringify({ stopAfter }))
        .first<{ id: string; status: string }>();
      if (existing) return existing;
      // Only someone who may build this project starts a new preview; viewers reuse existing ones.
      requirePermission(c, "builds.run");
      return queueBuild(c, i.revisionId, "view", { stopAfter });
    },
  ),
];
