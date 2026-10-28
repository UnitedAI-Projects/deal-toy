import { builtinSkills } from "./skills";
import { z } from "zod";
import {
  AppError,
  admin,
  id,
  modelAccess,
  projectAccess,
  revisionAccess,
  shortText,
  type Context,
} from "./core";
export type Tool = {
  name: string;
  description: string;
  schema: z.ZodObject;
  readOnly: boolean;
  adminOnly?: boolean;
  run: (context: Context, input: unknown) => Promise<unknown>;
};
function define<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  readOnly: boolean,
  run: (c: Context, input: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  adminOnly = false,
): Tool {
  const schema = z.object(shape).strict();
  return {
    name,
    description,
    schema,
    readOnly,
    adminOnly,
    run: (c, input) => run(c, schema.parse(input)),
  };
}
const now = () => new Date().toISOString();
export const tools: Tool[] = [
  define(
    "projects_list",
    "List your CAD projects.",
    {},
    true,
    async (c) =>
      (
        await c.env.DB.prepare(
          "SELECT * FROM projects WHERE owner=? ORDER BY created_at DESC LIMIT 200",
        )
          .bind(c.identity.email)
          .all()
      ).results,
  ),
  define(
    "projects_create",
    "Create a project with a design brief.",
    { name: shortText, brief: z.string().max(12000).default("") },
    false,
    async (c, i) => {
      const project = {
        id: crypto.randomUUID(),
        name: i.name,
        brief: i.brief,
        created_at: now(),
      };
      await c.env.DB.prepare("INSERT INTO projects VALUES (?,?,?,?,?)")
        .bind(
          project.id,
          c.identity.email,
          project.name,
          project.brief,
          project.created_at,
        )
        .run();
      return project;
    },
  ),
  define(
    "projects_get",
    "Read a project, its models, revisions, builds and manufacturing documents.",
    { projectId: id },
    true,
    async (c, i) => {
      const project = await projectAccess(c, i.projectId);
      const [models, revisions, jobs, artifacts, documents] =
        await c.env.DB.batch([
          c.env.DB.prepare("SELECT * FROM models WHERE project_id=?").bind(
            i.projectId,
          ),
          c.env.DB.prepare(
            "SELECT revisions.* FROM revisions JOIN models ON models.id=revisions.model_id WHERE models.project_id=? ORDER BY number DESC",
          ).bind(i.projectId),
          c.env.DB.prepare(
            "SELECT jobs.* FROM jobs JOIN revisions ON revisions.id=jobs.revision_id JOIN models ON models.id=revisions.model_id WHERE models.project_id=? ORDER BY created_at DESC",
          ).bind(i.projectId),
          c.env.DB.prepare(
            "SELECT artifacts.* FROM artifacts JOIN jobs ON jobs.id=artifacts.job_id JOIN revisions ON revisions.id=jobs.revision_id JOIN models ON models.id=revisions.model_id WHERE models.project_id=?",
          ).bind(i.projectId),
          c.env.DB.prepare(
            "SELECT * FROM documents WHERE project_id=? ORDER BY created_at DESC",
          ).bind(i.projectId),
        ]);
      return {
        project,
        models: models.results,
        revisions: revisions.results,
        jobs: jobs.results,
        artifacts: artifacts.results,
        documents: documents.results,
      };
    },
  ),
  define(
    "models_create",
    "Create a named CAD model inside a project.",
    { projectId: id, name: shortText },
    false,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      const model = {
        id: crypto.randomUUID(),
        project_id: i.projectId,
        name: i.name,
        revision: 0,
      };
      await c.env.DB.prepare("INSERT INTO models VALUES (?,?,?,0)")
        .bind(model.id, i.projectId, i.name)
        .run();
      return model;
    },
  ),
  define(
    "models_save",
    "Save an immutable build123d Python revision. Define build() returning a solid Shape; millimetres, Z up. Supply expectedRevision to prevent overwriting newer work.",
    {
      modelId: id,
      expectedRevision: z.number().int().nonnegative(),
      source: z.string().min(1).max(100000),
    },
    false,
    async (c, i) => {
      await modelAccess(c, i.modelId);
      const revisionId = crypto.randomUUID();
      const rows = await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO revisions SELECT ?,id,revision+1,?,? FROM models WHERE id=? AND revision=?",
        ).bind(revisionId, i.source, now(), i.modelId, i.expectedRevision),
        c.env.DB.prepare(
          "UPDATE models SET revision=revision+1 WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)",
        ).bind(i.modelId, i.expectedRevision, revisionId),
      ]);
      if (rows[0].meta.changes !== 1)
        throw new AppError(409, "Model changed. Reload before saving.");
      return { id: revisionId, number: i.expectedRevision + 1 };
    },
  ),
  define(
    "models_build",
    "Queue a revision for isolated OCCT validation and STEP/STL/GLB export. Poll builds_get for completion.",
    { revisionId: id },
    false,
    async (c, i) => {
      await revisionAccess(c, i.revisionId);
      const jobId = crypto.randomUUID();
      const admitted = await c.env.DB.prepare(
        "INSERT INTO jobs SELECT ?,?,'queued',NULL,NULL,?,? WHERE (SELECT count(*) FROM jobs WHERE status IN ('queued','running'))<10",
      )
        .bind(jobId, i.revisionId, now(), now())
        .run();
      if (admitted.meta.changes !== 1)
        throw new AppError(429, "Build queue is full; try later");
      try {
        await c.env.BUILDS.send({ jobId });
      } catch {
        await c.env.DB.prepare(
          "UPDATE jobs SET status='failed',error='Queue unavailable',updated_at=? WHERE id=?",
        )
          .bind(now(), jobId)
          .run();
        throw new AppError(503, "Build queue unavailable");
      }
      return { id: jobId, status: "queued" };
    },
  ),
  define(
    "builds_get",
    "Read build status, measured geometry facts and downloadable artifacts.",
    { jobId: id },
    true,
    async (c, i) => {
      const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?")
        .bind(i.jobId)
        .first<{ revision_id: string }>();
      if (!job) throw new AppError(404, "Build not found");
      await revisionAccess(c, job.revision_id);
      return {
        ...job,
        artifacts: (
          await c.env.DB.prepare(
            "SELECT id,name,media_type,sha256,size FROM artifacts WHERE job_id=?",
          )
            .bind(i.jobId)
            .all()
        ).results,
      };
    },
  ),
  define(
    "documents_add",
    "Save a versioned manufacturing brief or drawing review linked to an exact model revision. This records draft instructions, not manufacturing approval.",
    {
      projectId: id,
      revisionId: id.optional(),
      kind: z.enum([
        "manufacturing-brief",
        "drawing-review",
        "bom",
        "inspection-plan",
      ]),
      title: shortText,
      content: z.string().min(1).max(30000),
    },
    false,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      if (
        i.revisionId &&
        (await revisionAccess(c, i.revisionId)).project_id !== i.projectId
      )
        throw new AppError(400, "Revision belongs to another project");
      const docId = crypto.randomUUID();
      await c.env.DB.prepare(
        "INSERT INTO documents SELECT ?,?,?,?,?,?,COALESCE(MAX(version),0)+1,? FROM documents WHERE project_id=? AND kind=? AND title=?",
      )
        .bind(
          docId,
          i.projectId,
          i.revisionId ?? null,
          i.kind,
          i.title,
          i.content,
          now(),
          i.projectId,
          i.kind,
          i.title,
        )
        .run();
      return { id: docId, status: "draft" };
    },
  ),
  define(
    "skills_list",
    "List the latest version of each workflow skill.",
    {},
    true,
    async (c) => {
      const { results } = await c.env.DB.prepare(
        "SELECT * FROM skills s WHERE version=(SELECT MAX(version) FROM skills WHERE id=s.id) ORDER BY title",
      ).all<{ id: string }>();
      return [
        ...builtinSkills.filter((s) => !results.some((r) => r.id === s.id)),
        ...results,
      ];
    },
  ),
  define(
    "skills_save",
    "Publish a versioned Markdown workflow skill. Instructions cannot grant permissions or install executable tools.",
    {
      skillId: z.string().regex(/^[a-z][a-z0-9-]{1,59}$/),
      expectedVersion: z.number().int().nonnegative(),
      title: shortText,
      description: z.string().min(1).max(500),
      content: z.string().min(1).max(30000),
    },
    false,
    async (c, i) => {
      admin(c);
      const result = await c.env.DB.prepare(
        "INSERT INTO skills SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(version) FROM skills WHERE id=?),0)=?",
      )
        .bind(
          i.skillId,
          i.expectedVersion + 1,
          i.title,
          i.description,
          i.content,
          c.identity.email,
          now(),
          i.skillId,
          i.expectedVersion,
        )
        .run();
      if (result.meta.changes !== 1)
        throw new AppError(409, "Skill changed. Reload first");
      return { id: i.skillId, version: i.expectedVersion + 1 };
    },
    true,
  ),
  define(
    "tools_configure",
    "Enable or disable a registered executable tool. Adding executable code requires a reviewed deployment.",
    { name: shortText, enabled: z.boolean() },
    false,
    async (c, i) => {
      admin(c);
      if (!tools.some((t) => t.name === i.name) || i.name === "tools_configure")
        throw new AppError(400, "Tool cannot be configured");
      await c.env.DB.prepare(
        "INSERT INTO tool_settings VALUES (?,?) ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled",
      )
        .bind(i.name, i.enabled ? 1 : 0)
        .run();
      return i;
    },
    true,
  ),
];
export async function catalog(c: Context) {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM tool_settings",
  ).all<{ name: string; enabled: number }>();
  return tools
    .filter((t) => !t.adminOnly || c.identity.role === "admin")
    .map((t) => ({
      name: t.name,
      description: t.description,
      readOnly: t.readOnly,
      enabled: results.find((r) => r.name === t.name)?.enabled !== 0,
    }));
}
export async function execute(c: Context, name: string, input: unknown) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new AppError(404, "Tool not found");
  if (tool.adminOnly) admin(c);
  const setting = await c.env.DB.prepare(
    "SELECT enabled FROM tool_settings WHERE name=?",
  )
    .bind(name)
    .first<{ enabled: number }>();
  if (setting?.enabled === 0) throw new AppError(403, "Tool is disabled");
  return tool.run(c, input);
}
