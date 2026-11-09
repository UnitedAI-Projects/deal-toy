import { z } from "zod";
import { recordEvent } from "./activity";
import { AppError, id, modelAccess } from "./core";
import {
  frameworkSchema,
  sectionsSchema,
  sheetFor,
  type DesignSheet,
} from "./design/sheet";
import { define, now, type Tool } from "./tool-kit";

/**
 * Design sheets and change plans. An agent questions the person about every section of a model,
 * records the answers and the framework of layers with design_start, then declares each later
 * change with change_begin before any geometry tool may save it.
 */
const request = z.string().trim().min(1).max(2000);

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
];
/** Design tools that record their own events. */
export const DESIGN_WRITES = designTools
  .filter((t) => !t.readOnly)
  .map((t) => t.name);
