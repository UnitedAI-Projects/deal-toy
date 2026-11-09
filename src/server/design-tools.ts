import { z } from "zod";
import { recordEvent } from "./activity";
import { AppError, id, modelAccess, type Context } from "./core";
import {
  declared,
  otherPlanMessage,
  ownOpenPlan,
  planState,
  type PlanLayers,
} from "./design/plans";
import { layerNames } from "./design/ownership";
import {
  frameworkSchema,
  layerKind,
  layerName,
  mergeSections,
  regionSchema,
  sectionsSchema,
  sheetFor,
  uniqueNames,
  type DesignSheet,
} from "./design/sheet";
import { define, now, type Tool } from "./tool-kit";

/**
 * Design sheets and change plans. An agent questions the person about every section of a model,
 * records the answers and the framework of layers with design_start, then declares each later
 * change with change_begin before any geometry tool may save it.
 */
const request = z.string().trim().min(1).max(2000);
const anyLayer = z.string().trim().min(1).max(80);
const names = z.array(anyLayer).max(100).default([]);

/** The latest revision's step layer names; a model without a steps section has none. */
async function latestLayers(c: Context, modelId: string, revision: number) {
  const row = await c.env.DB.prepare(
    "SELECT source FROM revisions WHERE model_id=? AND number=?",
  )
    .bind(modelId, revision)
    .first<{ source: string }>();
  return row ? (layerNames(row.source) ?? []) : [];
}

export const designTools: Tool[] = [
  define(
    "design_start",
    [
      "Record a new model's design sheet before any geometry. First question the person in your own client about every section: overall size, the shape of each part (for a cup: body, rim, handle, foot), colours and finish, and any designs or lettering.",
      "Record each answer as a section with source 'answered'; anything you had to guess is 'assumed', and the person sees those marked for confirmation.",
      "The framework lists the layers the model is built from, in build order, each with its kind, the PARAMS it uses and the region it occupies (mm, Z up). The name Framework is reserved for PARAMS.",
      "This opens the framework's change plan: build each layer with steps_add (calling change_progress before each), then call change_finish.",
    ].join(" "),
    {
      modelId: id,
      request,
      sections: sectionsSchema,
      framework: frameworkSchema,
    },
    false,
    async (c, i) => {
      const model = await modelAccess(c, i.modelId);
      if (await sheetFor(c, i.modelId))
        throw new AppError(
          409,
          "This model already has a design sheet; change it through change_begin.",
        );
      const at = now();
      const planId = crypto.randomUUID();
      const layers = {
        add: i.framework.map(({ name, kind, region }) => ({
          name,
          kind,
          region,
        })),
        edit: [],
        remove: [],
        rename: [],
        follow: [],
        shared: false,
      };
      const [sheet] = await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO design_sheets (model_id,request,sections,framework,built,session_id,created_by,created_at,updated_at) SELECT ?,?,?,?,0,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM design_sheets WHERE model_id=?1)",
        ).bind(
          i.modelId,
          i.request,
          JSON.stringify(i.sections),
          JSON.stringify(i.framework),
          i.sessionId ?? null,
          c.identity.email,
          at,
          at,
        ),
        c.env.DB.prepare(
          "INSERT INTO change_plans (id,model_id,project_id,session_id,member,by_kind,framework,request,layers,sections,status,started_at,updated_at) SELECT ?,?,?,?,?,'agent',1,?,?,'[]','open',?,? WHERE EXISTS (SELECT 1 FROM design_sheets WHERE model_id=?2 AND created_at=?8 AND created_by=?5)",
        ).bind(
          planId,
          i.modelId,
          model.project_id,
          i.sessionId ?? null,
          c.identity.email,
          i.request,
          JSON.stringify(layers),
          at,
          at,
        ),
      ]);
      if (sheet.meta.changes !== 1)
        throw new AppError(
          409,
          "This model already has a design sheet; change it through change_begin.",
        );
      await recordEvent(c, {
        projectId: model.project_id,
        sessionId: i.sessionId ?? null,
        kind: "design",
        payload: {
          modelId: i.modelId,
          planId,
          request: i.request,
          assumed: i.sections
            .filter((s) => s.source === "assumed")
            .map((s) => s.name),
          framework: i.framework.map((l) => l.name),
        },
      });
      const stored = (await sheetFor(c, i.modelId)) as DesignSheet;
      return { sheet: stored, planId };
    },
    "models.edit",
  ),
  define(
    "design_get",
    "Read a model's design sheet: the request, each section's answer (assumed ones are guesses the person has not confirmed) and the framework of layers. Returns sheet: null for a model without one.",
    { modelId: id },
    true,
    async (c, i) => {
      await modelAccess(c, i.modelId, "read");
      return { sheet: await sheetFor(c, i.modelId) };
    },
  ),
  define(
    "change_begin",
    [
      "Declare a change before making it. Every later request on a model starts here: list the layers you will add, edit, remove or rename, and in follow the layers that change only because they follow another (a wall that follows a resized rim).",
      "Put Framework in edit to change PARAMS, and set shared: true to change imports, helpers or module constants. Writes outside the plan are refused.",
      "Pass sections to update the design sheet's answers by name (for example a new Rim answer). Then call change_progress before each layer and change_finish at the end.",
    ].join(" "),
    {
      modelId: id,
      request,
      add: z
        .array(
          z
            .object({ name: layerName, kind: layerKind, region: regionSchema })
            .strict(),
        )
        .max(100)
        .default([])
        .superRefine(uniqueNames("Layer")),
      edit: names,
      remove: names,
      rename: z
        .array(z.object({ from: anyLayer, to: layerName }).strict())
        .max(100)
        .default([]),
      follow: names,
      shared: z.boolean().default(false),
      sections: sectionsSchema.optional(),
    },
    false,
    async (c, i) => {
      const model = await modelAccess(c, i.modelId);
      const sheet = await sheetFor(c, i.modelId);
      if (!sheet)
        throw new AppError(
          400,
          "This model has no design sheet. Question the person about every section, then call design_start.",
        );
      if (
        !i.add.length &&
        !i.edit.length &&
        !i.remove.length &&
        !i.rename.length
      )
        throw new AppError(
          400,
          "A plan must add, edit, remove or rename at least one layer.",
        );
      const { open } = await planState(c, i.modelId);
      const busy = (plan: { startedAt: string; member: string }) =>
        new AppError(
          409,
          `A change plan is already open for this model (${otherPlanMessage(plan)}). Finish it with change_finish.`,
        );
      if (open) throw busy(open);
      const layers: PlanLayers = {
        add: i.add,
        edit: i.edit,
        remove: i.remove,
        rename: i.rename,
        follow: i.follow,
        shared: i.shared,
      };
      const at = now();
      const planId = crypto.randomUUID();
      const sections = i.sections ?? [];
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            "INSERT INTO change_plans (id,model_id,project_id,session_id,member,by_kind,framework,request,layers,sections,status,started_at,updated_at) VALUES (?,?,?,?,?,'agent',?,?,?,?,'open',?,?)",
          ).bind(
            planId,
            i.modelId,
            model.project_id,
            i.sessionId ?? null,
            c.identity.email,
            // Until the framework is built, every plan continues it.
            sheet.built ? 0 : 1,
            i.request,
            JSON.stringify(layers),
            JSON.stringify(sections),
            at,
            at,
          ),
          ...(sections.length
            ? [
                c.env.DB.prepare(
                  "UPDATE design_sheets SET sections=?,updated_at=? WHERE model_id=?",
                ).bind(
                  JSON.stringify(mergeSections(sheet.sections, sections)),
                  at,
                  i.modelId,
                ),
              ]
            : []),
        ]);
      } catch (error) {
        if (!String(error).includes("UNIQUE")) throw error;
        const raced = (await planState(c, i.modelId)).open;
        throw raced ? busy(raced) : error;
      }
      await recordEvent(c, {
        projectId: model.project_id,
        sessionId: i.sessionId ?? null,
        kind: "change",
        payload: {
          type: "begin",
          planId,
          modelId: i.modelId,
          request: i.request,
          add: i.add.map((l) => l.name),
          edit: i.edit,
          remove: i.remove,
          rename: i.rename,
          follow: i.follow,
        },
      });
      return { planId };
    },
    "models.edit",
  ),
  define(
    "change_progress",
    "Say which layer of your open change plan you are working on now, before you edit it, with up to five short phrases of what you are doing there. The person sees it on the model as you work.",
    {
      planId: id,
      layer: anyLayer,
      phrases: z.array(z.string().trim().min(1).max(120)).max(5).default([]),
    },
    false,
    async (c, i) => {
      const plan = await ownOpenPlan(c, i.planId);
      await modelAccess(c, plan.modelId);
      if (
        !declared(plan.layers).has(i.layer) &&
        !plan.layers.follow.includes(i.layer)
      )
        throw new AppError(400, `${i.layer} is not in this plan.`);
      await c.env.DB.prepare(
        "UPDATE change_plans SET current=?,phrases=?,updated_at=? WHERE id=?",
      )
        .bind(i.layer, JSON.stringify(i.phrases), now(), plan.id)
        .run();
      await recordEvent(c, {
        projectId: plan.projectId,
        sessionId: i.sessionId ?? plan.sessionId,
        kind: "change",
        payload: {
          type: "progress",
          planId: plan.id,
          modelId: plan.modelId,
          layer: i.layer,
          phrases: i.phrases,
        },
      });
      return { ok: true };
    },
    "models.edit",
  ),
  define(
    "change_finish",
    "Close your open change plan with a summary of what changed and any assumptions the person has not confirmed. A framework plan finishes only once every framework layer exists. For other plans, missing lists added layers that were never built.",
    { planId: id, summary: z.string().trim().min(1).max(2000) },
    false,
    async (c, i) => {
      const plan = await ownOpenPlan(c, i.planId);
      const model = await modelAccess(c, plan.modelId);
      const present = new Set(
        await latestLayers(c, plan.modelId, model.revision),
      );
      const at = now();
      let missing: string[];
      if (plan.framework) {
        const sheet = (await sheetFor(c, plan.modelId)) as DesignSheet;
        missing = sheet.framework
          .map((l) => l.name)
          .filter((n) => !present.has(n));
        if (missing.length)
          throw new AppError(
            400,
            `The framework is not built yet: missing ${missing.join(", ")}.`,
          );
      } else
        missing = plan.layers.add
          .map((l) => l.name)
          .filter((n) => !present.has(n));
      const [closed] = await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE change_plans SET status='finished',summary=?,current=NULL,updated_at=?,ended_at=? WHERE id=? AND status='open'",
        ).bind(i.summary, at, at, plan.id),
        ...(plan.framework
          ? [
              c.env.DB.prepare(
                "UPDATE design_sheets SET built=1,updated_at=?1 WHERE model_id=?2 AND EXISTS (SELECT 1 FROM change_plans WHERE id=?3 AND status='finished' AND ended_at=?1)",
              ).bind(at, plan.modelId, plan.id),
            ]
          : []),
      ]);
      if (closed.meta.changes !== 1)
        throw new AppError(409, "This plan is no longer open.");
      await recordEvent(c, {
        projectId: plan.projectId,
        sessionId: i.sessionId ?? plan.sessionId,
        kind: "change",
        payload: {
          type: "finish",
          planId: plan.id,
          modelId: plan.modelId,
          summary: i.summary,
          missing,
        },
      });
      return { ok: true, missing };
    },
    "models.edit",
  ),
];
/** Design tools that record their own events. */
export const DESIGN_WRITES = designTools
  .filter((t) => !t.readOnly)
  .map((t) => t.name);
