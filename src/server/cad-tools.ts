/* MantelCAD as the Model engine: reading a model's design and editing it with MantelCAD commands,
   which the CAD container applies with mantelcad-cli (engine/service.py, /edit). */
import { z } from "zod";
import { requirePermission } from "./access";
import {
  AppError,
  boundedText,
  id,
  modelAccess,
  projectAccess,
  type Context,
} from "./core";
import { sessionFor } from "./activity";
import {
  commandProblem,
  designOf,
  designSummary,
  MAX_DESIGN_BYTES,
  MAX_EDIT_COMMANDS,
  MAX_PYTHON_BYTES,
} from "../shared/cad-source";
import { define, queueBuild, saveRevision, type Tool } from "./tool-kit";

const seesSource = (c: Context, owner: string) =>
  owner === c.identity.email || c.identity.permissions.has("exports.download");

/** A design stored compactly (MantelCAD exports indented JSON); any other source unchanged. */
export function compactSource(source: string) {
  const design = designOf(source);
  return design ? JSON.stringify(design) : source;
}

/** Refuses a revision source Mantel cannot build: oversized, or a design written over MCP. */
export function checkSource(c: Context, source: string) {
  const bytes = new TextEncoder().encode(source).length;
  if (designOf(source)) {
    if (bytes > MAX_DESIGN_BYTES)
      throw new AppError(400, "A MantelCAD design can be up to 1 MB");
    // The change-plan guard reasons about build123d step layers, which a design does not have.
    if (c.channel === "mcp")
      throw new AppError(
        400,
        "MantelCAD designs are saved from MantelCAD or by Mantel's own agent; connected agents write build123d Python.",
      );
  } else if (bytes > MAX_PYTHON_BYTES)
    throw new AppError(400, "Python source can be up to 100 KB");
}

const command = z
  .object({
    command: z.string().min(3).max(80),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const editReply = z.object({
  design: z.string().max(MAX_DESIGN_BYTES),
  results: z.unknown(),
});

/** Runs MantelCAD commands on a design (null: a new one) in a fresh, single-use CAD container. */
export async function editDesign(
  env: Env,
  design: string | null,
  commands: z.infer<typeof command>[],
) {
  const container = env.CAD.getByName(`edit-${crypto.randomUUID()}`);
  try {
    const response = await container.fetch(
      new Request("http://cad/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design, commands }),
      }),
    );
    const text = await boundedText(
      new Request("http://result", {
        method: "POST",
        body: response.body,
        duplex: "half",
      } as RequestInit),
      3_000_000,
    );
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = z.object({ error: z.string() }).safeParse(payload);
      throw new AppError(
        response.status === 400 ? 400 : 502,
        detail.success
          ? detail.data.error
          : "MantelCAD could not apply the commands",
      );
    }
    const reply = editReply.safeParse(payload);
    if (!reply.success || !designOf(reply.data.design))
      throw new AppError(502, "MantelCAD returned no design");
    return reply.data;
  } finally {
    try {
      await container.destroy();
    } catch {
      console.error(JSON.stringify({ event: "container_cleanup_failed" }));
    }
  }
}

/** The project's model: the one named, or the one the Model phase shows. */
async function projectModel(c: Context, projectId: string, modelId?: string) {
  if (modelId) {
    const model = await modelAccess(c, modelId, "read");
    if (model.project_id !== projectId)
      throw new AppError(400, "The model belongs to another project");
    return model;
  }
  const row = await c.env.DB.prepare(
    // The model the Model phase shows (src/web/engine-views.ts currentModel): the most revised.
    "SELECT id FROM models WHERE project_id=? ORDER BY revision DESC, rowid DESC LIMIT 1",
  )
    .bind(projectId)
    .first<{ id: string }>();
  return row ? modelAccess(c, row.id, "read") : null;
}

async function latestSource(c: Context, modelId: string, revision: number) {
  if (revision === 0) return null;
  const row = await c.env.DB.prepare(
    "SELECT id,source FROM revisions WHERE model_id=? AND number=?",
  )
    .bind(modelId, revision)
    .first<{ id: string; source: string }>();
  if (!row) throw new AppError(404, "Revision not found");
  return row;
}

const COMMAND_GUIDE = `Commands run in order on the latest revision, as MantelCAD's own scripts do; lengths are mm unless an expression gives a unit, and expressions may use the design's parameters. Common commands:
- parameters.add {name, expression} / parameters.change {name, expression} or {changes: {name: expression}}
- sketch.create {plane: "XY"|"XZ"|"YZ" | {face: [x,y,z]}, name?} ... then sketch.finish {}
- sketch.line {points: [[x,y],...], closed?: true}; sketch.rectangle.center {center: [x,y], corner: [x,y]}; sketch.rectangle.two_point {p0, p1}; sketch.circle.center {center: [x,y], diameter | radius}
- solid.extrude {distance: expr, direction?: "positive"|"negative"|"symmetric", operation?: "new_body"|"join"|"cut"|"intersect", body_name?} (extrudes the last sketch's profiles)
- solid.revolve {axis: "x"|"y" | sketch line id, angle?: expr}
- solid.fillet {edges: [[x,y,z] point on each edge], radius}; solid.chamfer {edges, distance}; solid.shell {faces: [[x,y,z]], thickness}
- solid.hole {position: [x,y,z] on a face, diameter, depth? }; solid.box / solid.cylinder for primitives
- timeline.delete {feature: name}; timeline.suppress; appearance.* and material.* for looks
If a command fails, nothing is saved and the error names the command and the problem: fix the call and try again.`;

export const cadTools: Tool[] = [
  define(
    "model_get",
    "Read the project's model: its engine (MantelCAD design or legacy build123d Python), latest revision, the design's parameters and timeline features, and the latest build's status, size, parts and editable parameters.",
    { projectId: id, modelId: id.optional() },
    true,
    async (c, i) => {
      const project = await projectAccess(c, i.projectId, "read");
      const model = await projectModel(c, i.projectId, i.modelId);
      if (!model) return { model: null, engine: "mantelcad" };
      const revision = await latestSource(c, model.id, model.revision);
      const design = revision ? designOf(revision.source) : null;
      const job = revision
        ? await c.env.DB.prepare(
            "SELECT id,status,error,facts FROM jobs WHERE revision_id=? AND purpose='build' ORDER BY created_at DESC LIMIT 1",
          )
            .bind(revision.id)
            .first<{
              id: string;
              status: string;
              error: string | null;
              facts: string | null;
            }>()
        : null;
      const facts = job?.facts ? JSON.parse(job.facts) : null;
      return {
        model: { id: model.id, name: model.name, revision: model.revision },
        engine: !revision ? "mantelcad" : design ? "mantelcad" : "build123d",
        ...(design && seesSource(c, project.owner)
          ? { design: designSummary(design) }
          : {}),
        lastBuild: job
          ? {
              id: job.id,
              status: job.status,
              error: job.error?.slice(0, 600) ?? null,
              ...(facts
                ? {
                    bounds: facts.bounds,
                    volume_mm3: facts.volume_mm3,
                    parts: facts.parts,
                    params: facts.params,
                  }
                : {}),
            }
          : null,
      };
    },
  ),
  define(
    "models_edit",
    `Change the project's model in MantelCAD: apply MantelCAD commands to its latest revision (or start a new design when it has none), save the result as a new revision and queue its build. Use model_get first. Use models_set_parameter for a single parameter value. ${COMMAND_GUIDE}`,
    {
      projectId: id,
      modelId: id.optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
      commands: z.array(command).min(1).max(MAX_EDIT_COMMANDS),
      summary: z.string().min(1).max(200).optional(),
    },
    false,
    async (c, i) => {
      if (c.channel === "mcp")
        throw new AppError(
          400,
          "models_edit is for Mantel's own agent and the app; connected agents write build123d Python.",
        );
      requirePermission(c, "builds.run");
      for (const step of i.commands) {
        const problem = commandProblem(step.command);
        if (problem) throw new AppError(400, problem);
      }
      await projectAccess(c, i.projectId);
      if (
        i.sessionId &&
        (await sessionFor(c, i.sessionId)).project_id !== i.projectId
      )
        throw new AppError(400, "Session belongs to another project");
      let model = await projectModel(c, i.projectId, i.modelId);
      if (!model) {
        const created = crypto.randomUUID();
        await c.env.DB.prepare("INSERT INTO models VALUES (?,?,?,0)")
          .bind(created, i.projectId, "Model 01")
          .run();
        model = await modelAccess(c, created);
      }
      const expected = i.expectedRevision ?? model.revision;
      if (model.revision !== expected)
        throw new AppError(409, "Model changed. Reload before saving.");
      const current = await latestSource(c, model.id, expected);
      if (current && !designOf(current.source))
        throw new AppError(
          400,
          "This model is build123d Python; MantelCAD commands apply to MantelCAD designs. Use the steps_* tools for it.",
        );
      const edited = await editDesign(
        c.env,
        current?.source ?? null,
        i.commands,
      );
      const saved = await saveRevision(c, model.id, expected, edited.design, {
        sessionId: i.sessionId,
        request:
          i.summary ??
          `Applied ${i.commands.length} MantelCAD command${i.commands.length === 1 ? "" : "s"}`,
      });
      const build = await queueBuild(c, saved.id);
      return {
        modelId: model.id,
        revision: saved.number,
        revisionId: saved.id,
        buildId: build.id,
        results: edited.results,
      };
    },
    "models.edit",
  ),
];
