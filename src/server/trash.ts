import { z } from "zod";
import { ACTIVE_WINDOW_MS } from "./activity";
import { AppError, id, shortText, type Context } from "./core";
import { audit } from "./members";
import { define, now, type Tool } from "./tool-kit";

/**
 * The Trash. Deleting a project hides it from every list and tool (core.ts `visible`) for
 * TRASH_DAYS days, during which its owner can restore it. After that, or when a person deletes it
 * forever, `purge` removes its rows and build files. Agents may move projects to the Trash and
 * restore them, but only a person can delete one forever.
 */
export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;
const purgeAfter = (deletedAt: string) =>
  new Date(Date.parse(deletedAt) + TRASH_DAYS * DAY_MS).toISOString();

type Trashed = { id: string; name: string; deleted_at: string };

async function ownTrashed(c: Context, projectId: string) {
  const row = await c.env.DB.prepare(
    "SELECT id,name,deleted_at FROM projects WHERE id=? AND owner=? AND deleted_at IS NOT NULL",
  )
    .bind(projectId, c.identity.email)
    .first<Trashed>();
  if (!row) throw new AppError(404, "Project not found in the Trash");
  return row;
}

function confirmName(actual: string, typed: string) {
  if (actual !== typed.trim())
    throw new AppError(
      400,
      "Type the project's exact name to confirm; it did not match",
    );
}

/** Rows that point at the project, in an order its foreign keys allow deleting. */
function purgeStatements(db: D1Database, projectId: string) {
  const models = "SELECT id FROM models WHERE project_id=?1";
  const revisions = `SELECT id FROM revisions WHERE model_id IN (${models})`;
  const jobs = `SELECT id FROM jobs WHERE revision_id IN (${revisions})`;
  return [
    `DELETE FROM note_deliveries WHERE note_id IN (SELECT id FROM project_events WHERE project_id=?1)`,
    `DELETE FROM measurements WHERE build_id IN (${jobs})`,
    `DELETE FROM artifacts WHERE job_id IN (${jobs})`,
    `DELETE FROM saved_actions WHERE project_id=?1 OR revision_id IN (${revisions})`,
    `DELETE FROM presets WHERE project_id=?1`,
    `DELETE FROM selections WHERE model_id IN (${models})`,
    `DELETE FROM check_lists WHERE model_id IN (${models})`,
    `DELETE FROM design_sheets WHERE model_id IN (${models})`,
    `DELETE FROM documents WHERE project_id=?1`,
    `DELETE FROM jobs WHERE revision_id IN (${revisions})`,
    `DELETE FROM project_events WHERE project_id=?1`,
    `DELETE FROM revisions WHERE model_id IN (${models})`,
    `DELETE FROM change_plans WHERE project_id=?1 OR model_id IN (${models})`,
    `DELETE FROM sessions WHERE project_id=?1`,
    `DELETE FROM models WHERE project_id=?1`,
    `DELETE FROM projects WHERE id=?1 AND deleted_at IS NOT NULL`,
  ].map((sql) => db.prepare(sql).bind(projectId));
}

/**
 * Removes a trashed project for good: its build files first, then every row in one batch, so a
 * failure part-way leaves the project in the Trash to be purged again rather than files nobody
 * can find. A team saved action checked against one of its revisions blocks the purge: other
 * projects may use it.
 */
export async function purge(env: Env, projectId: string) {
  const team = await env.DB.prepare(
    "SELECT DISTINCT id FROM saved_actions WHERE scope='team' AND revision_id IN (SELECT revisions.id FROM revisions JOIN models ON models.id=revisions.model_id WHERE models.project_id=?)",
  )
    .bind(projectId)
    .all<{ id: string }>();
  if (team.results.length)
    throw new AppError(
      409,
      `Team saved actions were checked in this project (${team.results.map((r) => r.id).join(", ")}); other projects may use them`,
    );
  const { results } = await env.DB.prepare(
    "SELECT artifacts.object_key FROM artifacts JOIN jobs ON jobs.id=artifacts.job_id JOIN revisions ON revisions.id=jobs.revision_id JOIN models ON models.id=revisions.model_id WHERE models.project_id=?",
  )
    .bind(projectId)
    .all<{ object_key: string }>();
  const keys = results.map((r) => r.object_key);
  for (let i = 0; i < keys.length; i += 1000)
    await env.ARTIFACTS.delete(keys.slice(i, i + 1000));
  await env.DB.batch(purgeStatements(env.DB, projectId));
  return { files: keys.length };
}

/** The scheduled sweep: purges projects whose time in the Trash is up. */
export async function purgeExpired(env: Env, limit = 10) {
  const cutoff = new Date(Date.now() - TRASH_DAYS * DAY_MS).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id,name FROM projects WHERE deleted_at IS NOT NULL AND deleted_at<? ORDER BY deleted_at LIMIT ?",
  )
    .bind(cutoff, limit)
    .all<{ id: string; name: string }>();
  for (const p of results) {
    try {
      const { files } = await purge(env, p.id);
      await env.DB.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?,?)")
        .bind(
          crypto.randomUUID(),
          "trash-sweep",
          p.id,
          "project.purge",
          JSON.stringify({ name: p.name, files, after_days: TRASH_DAYS }),
          now(),
        )
        .run();
    } catch (error) {
      // One project that cannot be purged must not hold up the others; it is retried next sweep.
      console.error("Trash purge failed", p.id, error);
    }
  }
}

export const trashTools: Tool[] = [
  define(
    "projects_delete",
    `Move one of your projects to the Trash. It disappears from every list and tool, including the demo, and is deleted for good after ${TRASH_DAYS} days unless restored with projects_restore. Give the project's exact name to confirm. Refused while a build is queued or running or another agent session on it is active. Only a person can delete a project forever.`,
    { projectId: id, name: shortText },
    false,
    async (c, i) => {
      const project = await c.env.DB.prepare(
        "SELECT id,name FROM projects WHERE id=? AND owner=? AND deleted_at IS NULL",
      )
        .bind(i.projectId, c.identity.email)
        .first<{ id: string; name: string }>();
      if (!project) throw new AppError(404, "Project not found");
      confirmName(project.name, i.name);
      const since = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
      const [builds, sessions] = await c.env.DB.batch([
        c.env.DB.prepare(
          "SELECT count(*) AS n FROM jobs JOIN revisions ON revisions.id=jobs.revision_id JOIN models ON models.id=revisions.model_id WHERE models.project_id=? AND jobs.status IN ('queued','running')",
        ).bind(i.projectId),
        c.env.DB.prepare(
          "SELECT count(*) AS n FROM sessions WHERE project_id=? AND ended_at IS NULL AND last_event_at>? AND id<>?",
        ).bind(i.projectId, since, i.sessionId ?? ""),
      ]);
      if ((builds.results[0] as { n: number }).n)
        throw new AppError(
          409,
          "A build is queued or running; wait for it to finish",
        );
      if ((sessions.results[0] as { n: number }).n)
        throw new AppError(
          409,
          "An agent session on this project is active; end it or wait for it to go idle",
        );
      const deletedAt = now();
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE projects SET deleted_at=?,deleted_by=? WHERE id=? AND deleted_at IS NULL",
        ).bind(deletedAt, c.identity.email, i.projectId),
        audit(c, i.projectId, "project.trash", { name: project.name }),
      ]);
      return {
        id: project.id,
        name: project.name,
        deleted_at: deletedAt,
        purge_after: purgeAfter(deletedAt),
      };
    },
  ),
  define(
    "projects_trash",
    `List your projects in the Trash, with when each was deleted, by whom, and when it will be deleted for good (${TRASH_DAYS} days later).`,
    {},
    true,
    async (c) => {
      const { results } = await c.env.DB.prepare(
        "SELECT id,name,brief,demo,created_at,deleted_at,deleted_by FROM projects WHERE owner=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200",
      )
        .bind(c.identity.email)
        .all<Trashed & Record<string, unknown>>();
      return {
        projects: results.map((p) => ({
          ...p,
          purge_after: purgeAfter(p.deleted_at),
        })),
      };
    },
  ),
  define(
    "projects_restore",
    "Restore one of your projects from the Trash, exactly as it was when it was deleted.",
    { projectId: id },
    false,
    async (c, i) => {
      const project = await ownTrashed(c, i.projectId);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE projects SET deleted_at=NULL,deleted_by=NULL WHERE id=?",
        ).bind(i.projectId),
        audit(c, i.projectId, "project.restore", { name: project.name }),
      ]);
      return { id: project.id, name: project.name };
    },
  ),
  define(
    "projects_purge",
    "Delete a project in the Trash forever: its models, revisions, builds, files, documents and activity. It cannot be undone. Only a person can do this, from the Trash in the web interface; agent requests are refused.",
    { projectId: id, name: z.string().trim().min(1).max(120) },
    false,
    async (c, i) => {
      if (c.channel === "mcp")
        throw new AppError(
          403,
          "Only a person can delete a project forever, from the Trash",
        );
      const project = await ownTrashed(c, i.projectId);
      confirmName(project.name, i.name);
      const { files } = await purge(c.env, i.projectId);
      await audit(c, i.projectId, "project.purge", {
        name: project.name,
        files,
      }).run();
      return { id: project.id, name: project.name, files };
    },
  ),
];
