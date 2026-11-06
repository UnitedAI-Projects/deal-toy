import { AppError, type Context } from "../core";
import type { ActionRecord } from "./catalog";
import { readSteps } from "./script";

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
