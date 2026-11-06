import { z } from "zod";
import { AppError, type Context } from "../core";
import type { ActionRecord } from "./catalog";
import { readSteps } from "./script";
import { unsupportedKeywords } from "./validate";

/** Saved custom actions: versioned, checked by a build, and visible to their project or the team. */
export const SAVED_KEY = /^([a-z][a-z0-9-]{1,39})@([0-9]{1,6})$/;
export type SavedAction = {
  key: string;
  id: string;
  version: number;
  scope: "project" | "team";
  record: ActionRecord;
  source: string;
  createdAt: string;
};
type Row = {
  id: string;
  version: number;
  scope: "project" | "team";
  record: string;
  source: string;
  created_at: string;
};
const VISIBLE = "status='ready' AND (scope='team' OR project_id=?)";

function fromRow(row: Row): SavedAction {
  return {
    key: `${row.id}@${row.version}`,
    id: row.id,
    version: row.version,
    scope: row.scope,
    record: JSON.parse(row.record) as ActionRecord,
    source: row.source,
    createdAt: row.created_at,
  };
}

/** One ready saved action the project may use, or 404. */
export async function savedAction(
  c: Context,
  projectId: string,
  key: string,
): Promise<SavedAction> {
  const match = SAVED_KEY.exec(key);
  const row = match
    ? await c.env.DB.prepare(
        `SELECT * FROM saved_actions WHERE id=? AND version=? AND ${VISIBLE}`,
      )
        .bind(match[1], Number(match[2]), projectId)
        .first<Row>()
    : null;
  if (!row) throw new AppError(404, `No saved action ${key}`);
  return fromRow(row);
}

/** The latest ready version of every saved action the project may use (team actions only without one). */
export async function visibleSaved(
  c: Context,
  projectId: string | null,
): Promise<SavedAction[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM saved_actions s WHERE ${VISIBLE} AND version=(SELECT MAX(version) FROM saved_actions WHERE id=s.id AND ${VISIBLE}) ORDER BY id`,
  )
    .bind(projectId ?? "", projectId ?? "")
    .all<Row>();
  return results.map(fromRow);
}

/** Sources of the saved actions a script's steps pin, limited to the ones its project may use. */
export async function sourcesFor(
  env: Pick<Env, "DB">,
  projectId: string,
  source: string,
): Promise<Record<string, string>> {
  let keys: string[];
  try {
    keys = readSteps(source)
      .steps.filter(
        (s) => s.action === "custom" && typeof s.inputs.action === "string",
      )
      .map((s) => s.inputs.action as string);
  } catch (error) {
    if (error instanceof AppError) return {};
    throw error;
  }
  const out: Record<string, string> = {};
  for (const key of [...new Set(keys)].slice(0, 20)) {
    const match = SAVED_KEY.exec(key);
    if (!match) continue;
    const row = await env.DB.prepare(
      `SELECT source FROM saved_actions WHERE id=? AND version=? AND ${VISIBLE}`,
    )
      .bind(match[1], Number(match[2]), projectId)
      .first<{ source: string }>();
    if (row) out[key] = row.source;
  }
  return out;
}

const stepLog = z
  .object({
    name: z.string(),
    action: z.string(),
    version: z.number(),
    state: z.enum(["ok", "warning", "failed", "blocked", "suppressed"]),
    code: z.string().optional(),
    message: z.string().optional(),
    created: z.array(z.string()),
    ms: z.number(),
  })
  .passthrough();
/** A saved action's record as the engine reads it from the decorator: the built-in record shape. */
export const actionRecordSchema = z.object({
  id: z.string().regex(SAVED_KEY),
  version: z.number().int().positive(),
  title: z.string().min(1).max(120),
  category: z.literal("Custom"),
  summary: z.string().min(1).max(120),
  description: z.string().max(4000),
  inputs: z.object({
    type: z.literal("object"),
    properties: z.record(
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
      z.record(z.string(), z.unknown()),
    ),
    required: z.array(z.string()),
    additionalProperties: z.literal(false),
  }),
  selections: z.array(
    z.object({
      input: z.string(),
      kind: z.enum(["face", "edge", "plane", "point", "part"]),
      min: z.number(),
      max: z.number(),
    }),
  ),
  creates: z.record(z.string().max(40), z.string().max(300)),
  failures: z.array(
    z.object({ code: z.string(), explanation: z.string(), fix: z.string() }),
  ),
  preview: z.literal("none"),
  example: z.string().min(1).max(2000),
});
export const checkSchema = z
  .object({
    key: z.string(),
    record: z.unknown().optional(),
    step: stepLog.optional(),
    error: z.string().max(600).optional(),
  })
  .strict();

/** Whether a check build's result admits the candidate into the store. */
export function checkVerdict(
  key: string,
  check: unknown,
):
  | { status: "ready"; record: ActionRecord }
  | { status: "rejected"; error: string } {
  const parsed = checkSchema.safeParse(check);
  if (!parsed.success)
    return { status: "rejected", error: "The check build reported no result" };
  if (parsed.data.error)
    return { status: "rejected", error: parsed.data.error };
  const record = actionRecordSchema.safeParse(parsed.data.record);
  if (!record.success || record.data.id !== key)
    return {
      status: "rejected",
      error: "The action's description is incomplete or names another action",
    };
  if (unsupportedKeywords(record.data.inputs).length)
    return {
      status: "rejected",
      error: "The action's inputs use unsupported schema keywords",
    };
  const step = parsed.data.step;
  if (!step || step.state !== "ok")
    return {
      status: "rejected",
      error: step
        ? `The example step ${step.state}${step.code ? ` (${step.code})` : ""}: ${step.message ?? ""}`.trim()
        : "The example did not run",
    };
  const missing = Object.keys(record.data.creates).filter(
    (name) => !step.created.includes(name),
  );
  if (missing.length)
    return {
      status: "rejected",
      error: `The example did not create: ${missing.join(", ")}`,
    };
  return { status: "ready", record: record.data as ActionRecord };
}

export type Preset = {
  id: string;
  version: number;
  action: string;
  name: string;
  description: string;
  inputs: Record<string, unknown>;
  scope: "project" | "team";
  createdAt: string;
};
type PresetRow = Omit<Preset, "inputs" | "createdAt"> & {
  inputs: string;
  created_at: string;
};
const PRESET_VISIBLE = "(scope='team' OR project_id=?)";
const toPreset = ({ inputs, created_at, ...row }: PresetRow): Preset => ({
  ...row,
  inputs: JSON.parse(inputs) as Record<string, unknown>,
  createdAt: created_at,
});

/** The latest version of every preset the project may use. */
export async function visiblePresets(
  c: Context,
  projectId: string | null,
): Promise<Preset[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM presets p WHERE ${PRESET_VISIBLE} AND version=(SELECT MAX(version) FROM presets WHERE id=p.id) ORDER BY action, name`,
  )
    .bind(projectId ?? "")
    .all<PresetRow>();
  return results.map(toPreset);
}

/** One preset by id, latest version, if the project may use it. */
export async function presetFor(
  c: Context,
  projectId: string,
  id: string,
): Promise<Preset> {
  const row = await c.env.DB.prepare(
    `SELECT * FROM presets WHERE id=? AND ${PRESET_VISIBLE} ORDER BY version DESC LIMIT 1`,
  )
    .bind(id, projectId)
    .first<PresetRow>();
  if (!row) throw new AppError(404, `No preset ${id}`);
  return toPreset(row);
}
