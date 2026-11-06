import { z } from "zod";
import { requirePermission } from "./access";
import { actions } from "./actions/catalog";
import {
  assertIdOwner,
  savedAction,
  SAVED_KEY,
  visiblePresets,
} from "./actions/saved";
import { getAction } from "./actions/catalog";
import { validatePartial } from "./actions/validate";
import { readSteps } from "./actions/script";
import {
  AppError,
  id,
  modelAccess,
  projectAccess,
  revisionAccess,
} from "./core";
import { define, now, queueBuild, type Tool } from "./tool-kit";

const actionId = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{1,39}$/,
    "Use lowercase words joined by hyphens, for example finger-notch",
  );

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
  define(
    "actions_save",
    'Save a custom action for reuse: source is a Python module defining one function decorated with @mt.action(id=..., summary=..., inputs={...described helpers such as mt.Face, mt.Length...}, creates={...}, example=\'m.custom("Name", action="<id>@1", ...)\'), whose docstring says when to use it. Mantel builds the model\'s latest revision with the example appended; the action becomes ready only if that step is ok and creates every declared name. Poll actions_status. Project scope by default; team scope needs the settings permission. Afterwards replace fn= calls with action="<id>@<version>" using steps_edit.',
    {
      modelId: id,
      id: actionId,
      expectedVersion: z.number().int().nonnegative(),
      source: z.string().min(1).max(100_000),
      scope: z.enum(["project", "team"]).default("project"),
    },
    false,
    async (c, i) => {
      if (actions.some((a) => a.id === i.id))
        throw new AppError(
          400,
          `${i.id} is a built-in action; choose another id`,
        );
      if (i.scope === "team") requirePermission(c, "settings.manage");
      const model = await modelAccess(c, i.modelId);
      const revision = await c.env.DB.prepare(
        "SELECT id FROM revisions WHERE model_id=? AND number=?",
      )
        .bind(i.modelId, model.revision)
        .first<{ id: string }>();
      if (!revision)
        throw new AppError(
          400,
          "Save a revision of the model first; the check builds it",
        );
      await assertIdOwner(c, "saved_actions", i.id, i.scope, model.project_id);
      const version = i.expectedVersion + 1;
      const inserted = await c.env.DB.prepare(
        "INSERT INTO saved_actions (id,version,scope,project_id,status,record,source,error,revision_id,job_id,created_by,created_at) SELECT ?,?,?,?,'checking',NULL,?,NULL,?,NULL,?,? WHERE COALESCE((SELECT MAX(version) FROM saved_actions WHERE id=?),0)=?",
      )
        .bind(
          i.id,
          version,
          i.scope,
          i.scope === "project" ? model.project_id : null,
          i.source,
          revision.id,
          c.identity.email,
          now(),
          i.id,
          i.expectedVersion,
        )
        .run();
      if (inserted.meta.changes !== 1)
        throw new AppError(409, "Action changed. Reload first");
      const key = `${i.id}@${version}`;
      let job: { id: string; status: string };
      try {
        job = await queueBuild(c, revision.id, "check", { check: key });
      } catch (error) {
        await c.env.DB.prepare(
          "UPDATE saved_actions SET status='rejected',error=? WHERE id=? AND version=?",
        )
          .bind(
            error instanceof Error
              ? error.message
              : "Could not queue the check",
            i.id,
            version,
          )
          .run();
        throw error;
      }
      await c.env.DB.prepare(
        "UPDATE saved_actions SET job_id=? WHERE id=? AND version=?",
      )
        .bind(job.id, i.id, version)
        .run();
      return { key, status: "checking", job };
    },
    ["models.edit", "builds.run"],
  ),
  define(
    "presets_save",
    "Save a preset: a named, described set of input values for one action (a built-in id or a saved action id@version), such as an M3 counterbore. Presets may leave inputs out; steps_add with preset fills them in, and explicit inputs win. Project scope by default; team scope needs the settings permission.",
    {
      projectId: id,
      id: actionId,
      expectedVersion: z.number().int().nonnegative(),
      action: z.string().max(48),
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().min(1).max(500),
      inputs: z.record(z.string(), z.unknown()),
      scope: z.enum(["project", "team"]).default("project"),
    },
    false,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      if (i.scope === "team") requirePermission(c, "settings.manage");
      const record = SAVED_KEY.test(i.action)
        ? (await savedAction(c, i.projectId, i.action)).record
        : getAction(i.action);
      validatePartial(record, i.inputs);
      await assertIdOwner(c, "presets", i.id, i.scope, i.projectId);
      const version = i.expectedVersion + 1;
      const inserted = await c.env.DB.prepare(
        "INSERT INTO presets (id,version,action,name,description,inputs,scope,project_id,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(version) FROM presets WHERE id=?),0)=?",
      )
        .bind(
          i.id,
          version,
          i.action,
          i.name,
          i.description,
          JSON.stringify(i.inputs),
          i.scope,
          i.scope === "project" ? i.projectId : null,
          c.identity.email,
          now(),
          i.id,
          i.expectedVersion,
        )
        .run();
      if (inserted.meta.changes !== 1)
        throw new AppError(409, "Preset changed. Reload first");
      return { id: i.id, version };
    },
    "models.edit",
  ),
  define(
    "presets_list",
    "List the presets you may use in a project (team presets everywhere), latest version of each, optionally for one action.",
    { projectId: id.optional(), action: z.string().max(48).optional() },
    true,
    async (c, i) => {
      if (i.projectId) await projectAccess(c, i.projectId, "read");
      const presets = await visiblePresets(c, i.projectId ?? null);
      return presets.filter((p) => !i.action || p.action === i.action);
    },
  ),
  define(
    "actions_status",
    "Read whether a saved action version is checking, ready or rejected, with the reason it was rejected and its record once ready.",
    { key: z.string().regex(SAVED_KEY) },
    true,
    async (c, i) => {
      const [, actionName, version] = SAVED_KEY.exec(i.key)!;
      const row = await c.env.DB.prepare(
        "SELECT * FROM saved_actions WHERE id=? AND version=?",
      )
        .bind(actionName, Number(version))
        .first<{
          created_by: string;
          scope: string;
          project_id: string | null;
          status: string;
          error: string | null;
          record: string | null;
          job_id: string | null;
        }>();
      const missing = new AppError(404, `No saved action ${i.key}`);
      if (!row) throw missing;
      // A ready version is visible like the catalog; one still checking or rejected only to its maker
      // and to those who may change it.
      if (row.status === "ready" || row.created_by !== c.identity.email) {
        if (row.scope === "project")
          await projectAccess(
            c,
            row.project_id!,
            row.status === "ready" ? "read" : "write",
          ).catch(() => {
            throw missing;
          });
        else if (
          row.status !== "ready" &&
          !c.identity.permissions.has("settings.manage")
        )
          throw missing;
      }
      return {
        key: i.key,
        status: row.status,
        ...(row.error ? { error: row.error } : {}),
        ...(row.record ? { record: JSON.parse(row.record) } : {}),
        job: row.job_id,
      };
    },
  ),
];
