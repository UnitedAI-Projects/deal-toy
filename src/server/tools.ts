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
import {
  ACTIVE_WINDOW_MS,
  clip,
  notify,
  parseEvent,
  recordEvent,
  resolveProject,
  sessionFor,
  takeNotes,
  type Note,
} from "./activity";
import { setParameter } from "./params";
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
  run: (
    c: Context,
    input: z.infer<z.ZodObject<S>> & { sessionId?: string },
  ) => Promise<unknown>,
  adminOnly = false,
): Tool {
  // Every tool accepts an optional sessionId so the call attaches to an agent session.
  const schema = z.object({ sessionId: id.optional(), ...shape }).strict();
  return {
    name,
    description,
    schema,
    readOnly,
    adminOnly,
    run: (c, input) =>
      run(
        c,
        schema.parse(input) as z.infer<z.ZodObject<S>> & { sessionId?: string },
      ),
  };
}
const now = () => new Date().toISOString();
async function saveRevision(
  c: Context,
  modelId: string,
  expectedRevision: number,
  source: string,
) {
  await modelAccess(c, modelId);
  const revisionId = crypto.randomUUID();
  const rows = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO revisions SELECT ?,id,revision+1,?,? FROM models WHERE id=? AND revision=?",
    ).bind(revisionId, source, now(), modelId, expectedRevision),
    c.env.DB.prepare(
      "UPDATE models SET revision=revision+1 WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)",
    ).bind(modelId, expectedRevision, revisionId),
  ]);
  if (rows[0].meta.changes !== 1)
    throw new AppError(409, "Model changed. Reload before saving.");
  return { id: revisionId, number: expectedRevision + 1 };
}
async function queueBuild(c: Context, revisionId: string) {
  await revisionAccess(c, revisionId);
  const jobId = crypto.randomUUID();
  const admitted = await c.env.DB.prepare(
    "INSERT INTO jobs SELECT ?,?,'queued',NULL,NULL,?,? WHERE (SELECT count(*) FROM jobs WHERE status IN ('queued','running'))<10",
  )
    .bind(jobId, revisionId, now(), now())
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
}
type ParamSpec = {
  value: number;
  unit?: string;
  part?: string;
  min?: number;
  max?: number;
};
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
    async (c, i) => saveRevision(c, i.modelId, i.expectedRevision, i.source),
  ),
  define(
    "models_build",
    "Queue a revision for isolated OCCT validation and STEP/STL/GLB export. Poll builds_get for completion.",
    { revisionId: id },
    false,
    async (c, i) => queueBuild(c, i.revisionId),
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
    "session_start",
    "Call first, before modelling. Starts an agent session on a project so the team sees your work live. Pass the user's request verbatim as prompt (not a summary). Returns sessionId: pass it to every later tool call. Team notes waiting for you are appended to tool results.",
    {
      projectId: id,
      prompt: z.string().trim().min(1).max(20000),
      title: shortText.optional(),
      client: z.string().trim().max(120).optional(),
    },
    false,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      const session = {
        id: crypto.randomUUID(),
        started_at: now(),
      };
      await c.env.DB.prepare(
        "INSERT INTO sessions VALUES (?,?,?,?,?,?,NULL,?,NULL,?)",
      )
        .bind(
          session.id,
          i.projectId,
          c.identity.email,
          i.client ?? null,
          i.prompt,
          i.title ?? null,
          session.started_at,
          session.started_at,
        )
        .run();
      await recordEvent(c, {
        projectId: i.projectId,
        sessionId: session.id,
        kind: "prompt",
        payload: {
          prompt: i.prompt,
          title: i.title ?? null,
          client: i.client ?? null,
        },
      });
      return { sessionId: session.id, startedAt: session.started_at };
    },
  ),
  define(
    "session_update",
    "Tell the people watching what you are about to do or why, in one short sentence. Call before each meaningful step; acknowledge team notes here.",
    { sessionId: id, message: z.string().trim().min(1).max(1000) },
    false,
    async (c, i) => {
      const session = await sessionFor(c, i.sessionId);
      if (session.ended_at) throw new AppError(409, "Session has ended");
      await recordEvent(c, {
        projectId: session.project_id,
        sessionId: session.id,
        kind: "agent_update",
        payload: { message: i.message },
      });
      return { ok: true };
    },
  ),
  define(
    "session_end",
    "Close your session with a one or two sentence summary of the result and anything left undone.",
    { sessionId: id, summary: z.string().trim().max(4000).default("") },
    false,
    async (c, i) => {
      const session = await sessionFor(c, i.sessionId);
      if (session.ended_at) return { ok: true, endedAt: session.ended_at };
      const endedAt = now();
      await c.env.DB.prepare(
        "UPDATE sessions SET ended_at=?,summary=? WHERE id=? AND ended_at IS NULL",
      )
        .bind(endedAt, i.summary, session.id)
        .run();
      await recordEvent(c, {
        projectId: session.project_id,
        sessionId: session.id,
        kind: "ended",
        payload: { summary: i.summary },
      });
      return { ok: true, endedAt };
    },
  ),
  define(
    "notes_add",
    "Leave a note for the agents working on a project. Running sessions receive it with their next tool call; otherwise the next session does.",
    { projectId: id, message: z.string().trim().min(1).max(4000) },
    false,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      const active = await c.env.DB.prepare(
        "SELECT count(*) AS n FROM sessions WHERE project_id=? AND ended_at IS NULL AND last_event_at>?",
      )
        .bind(
          i.projectId,
          new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString(),
        )
        .first<{ n: number }>();
      const event = await recordEvent(c, {
        projectId: i.projectId,
        kind: "team_note",
        payload: { message: i.message },
      });
      return { id: event?.id, activeSessions: active?.n ?? 0 };
    },
  ),
  define(
    "projects_activity",
    "Read a project's agent sessions and its recent activity log, oldest first.",
    { projectId: id },
    true,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      const since = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
      const [sessions, events] = await c.env.DB.batch([
        c.env.DB.prepare(
          "SELECT *, (ended_at IS NULL AND last_event_at>?) AS active FROM sessions WHERE project_id=? ORDER BY started_at DESC LIMIT 50",
        ).bind(since, i.projectId),
        c.env.DB.prepare(
          "SELECT * FROM (SELECT rowid AS seq, * FROM project_events WHERE project_id=? ORDER BY rowid DESC LIMIT 500) ORDER BY seq",
        ).bind(i.projectId),
      ]);
      return {
        sessions: (sessions.results as Record<string, unknown>[]).map((s) => ({
          ...s,
          active: Boolean(s.active),
        })),
        events: (events.results as Parameters<typeof parseEvent>[0][]).map(
          (e) => {
            const { seq: _seq, ...row } = e as typeof e & { seq?: number };
            return parseEvent(row);
          },
        ),
      };
    },
  ),
  define(
    "models_set_parameter",
    "Change one declared PARAMS value of the latest revision, save it as a new revision and queue its build. Only the value literal changes; the edit is refused if it cannot be located exactly once or is out of range.",
    {
      modelId: id,
      expectedRevision: z.number().int().positive(),
      name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
      value: z.number().finite(),
    },
    false,
    async (c, i) => {
      const model = await modelAccess(c, i.modelId);
      if (model.revision !== i.expectedRevision)
        throw new AppError(409, "Model changed. Reload before saving.");
      const revision = await c.env.DB.prepare(
        "SELECT * FROM revisions WHERE model_id=? AND number=?",
      )
        .bind(i.modelId, i.expectedRevision)
        .first<{ id: string; source: string }>();
      if (!revision) throw new AppError(404, "Revision not found");
      const job = await c.env.DB.prepare(
        "SELECT facts FROM jobs WHERE revision_id=? AND status='succeeded' ORDER BY created_at DESC LIMIT 1",
      )
        .bind(revision.id)
        .first<{ facts: string }>();
      const params = (job ? JSON.parse(job.facts).params : undefined) as
        Record<string, ParamSpec> | undefined;
      const spec = params?.[i.name];
      if (!spec)
        throw new AppError(
          400,
          "This revision has no built parameter with that name; build it first",
        );
      if (
        (spec.min !== undefined && i.value < spec.min) ||
        (spec.max !== undefined && i.value > spec.max)
      )
        throw new AppError(
          400,
          `${i.name} must be between ${spec.min ?? "−∞"} and ${spec.max ?? "∞"}`,
        );
      const source = setParameter(revision.source, i.name, i.value);
      const saved = await saveRevision(
        c,
        i.modelId,
        i.expectedRevision,
        source,
      );
      const build = await queueBuild(c, saved.id);
      const unit = spec.unit ? ` ${spec.unit}` : "";
      await recordEvent(c, {
        projectId: model.project_id,
        sessionId: i.sessionId ?? null,
        kind: "team_edit",
        payload: {
          message: `Changed ${i.name} from ${spec.value}${unit} to ${i.value}${unit} in revision ${saved.number}`,
          name: i.name,
          from: spec.value,
          to: i.value,
          unit: spec.unit ?? null,
          part: spec.part ?? null,
          modelId: i.modelId,
          revision: saved.number,
        },
      });
      return { revision: saved, job: build };
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
export type Channel = "mcp" | "http" | "internal";
/** Tools that write their own events; recording them as tool calls too would duplicate. */
const SELF_RECORDING = new Set([
  "session_start",
  "session_update",
  "session_end",
  "notes_add",
  "projects_activity",
  "models_set_parameter",
]);
const MODEL_CHANGES = new Set([
  "models_create",
  "models_save",
  "models_build",
  "models_set_parameter",
]);
function summarize(name: string, input: unknown, value: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  const v = (value ?? {}) as Record<string, unknown>;
  switch (name) {
    case "models_save":
      return `Saved revision ${v.number}`;
    case "models_build":
      return "Queued a build";
    case "builds_get":
      return `Build ${v.status}${v.error ? `: ${String(v.error).slice(0, 200)}` : ""}`;
    case "models_create":
      return `Created model ${i.name}`;
    case "projects_get":
      return "Read the project";
    case "projects_create":
      return `Created project ${i.name}`;
    case "documents_add":
      return `Saved ${i.kind} draft`;
    default:
      return name;
  }
}
/**
 * Runs a tool with its authorization and enablement checks. Agent (MCP) calls, and changes
 * made from the interface, are recorded in the project's activity log; MCP replies carry any
 * team notes waiting for the calling agent.
 */
export async function dispatch(
  c: Context,
  name: string,
  input: unknown,
  channel: Channel,
): Promise<{ value: unknown; notes: Note[] }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new AppError(404, "Tool not found");
  if (tool.adminOnly) admin(c);
  const setting = await c.env.DB.prepare(
    "SELECT enabled FROM tool_settings WHERE name=?",
  )
    .bind(name)
    .first<{ enabled: number }>();
  if (setting?.enabled === 0) throw new AppError(403, "Tool is disabled");
  const fields =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const sessionId =
    typeof fields.sessionId === "string" ? fields.sessionId : undefined;
  const record =
    !SELF_RECORDING.has(name) &&
    (channel === "mcp" || (channel === "http" && !tool.readOnly));
  let projectId =
    channel !== "internal" ? await resolveProject(c, input) : undefined;
  if (sessionId && !SELF_RECORDING.has(name)) {
    const session = await sessionFor(c, sessionId);
    if (projectId && session.project_id !== projectId)
      throw new AppError(400, "Session belongs to another project");
  }
  const started = Date.now();
  const log = (ok: boolean, summary: string) =>
    record && projectId
      ? recordEvent(c, {
          projectId,
          sessionId: sessionId ?? null,
          kind: "tool_call",
          payload: {
            tool: name,
            ok,
            ms: Date.now() - started,
            summary,
            channel,
            args: clip(
              Object.fromEntries(
                Object.entries(fields).filter(([k]) => k !== "sessionId"),
              ),
            ),
          },
        })
      : null;
  let value: unknown;
  try {
    value = await tool.run(c, input);
  } catch (error) {
    await log(
      false,
      error instanceof AppError
        ? error.message
        : error instanceof z.ZodError
          ? "Invalid arguments"
          : "Tool failed",
    );
    throw error;
  }
  if (name === "projects_create") projectId = (value as { id: string }).id;
  await log(true, summarize(name, input, value));
  if (projectId && MODEL_CHANGES.has(name))
    await notify(c.env, projectId, { type: "workspace" });
  let notes: Note[] = [];
  if (channel === "mcp" && projectId) {
    const target =
      name === "session_start"
        ? (value as { sessionId: string }).sessionId
        : sessionId;
    if (target || name === "projects_get")
      notes = await takeNotes(c, projectId, target ?? null);
  }
  return { value, notes };
}
export async function execute(c: Context, name: string, input: unknown) {
  return (await dispatch(c, name, input, "internal")).value;
}
