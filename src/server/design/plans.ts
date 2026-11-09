import { recordEvent } from "../activity";
import { AppError, type Context } from "../core";
import {
  RESERVED_LAYER,
  type LayerKind,
  type Region,
  type Section,
} from "./sheet";

/**
 * Change plans: what one request will change on a model, declared before any write. At most one
 * plan is open per model; it closes as finished, or as stopped when its session ends or after
 * STALE_MS without activity.
 */
export const STALE_MS = 30 * 60_000;
export const STALE_NOTE = " It stopped after 30 minutes without activity.";
export type PlanLayers = {
  /** region is null on person changes, which declare none. */
  add: { name: string; kind: LayerKind; region: Region | null }[];
  edit: string[];
  remove: string[];
  rename: { from: string; to: string }[];
  follow: string[];
  shared: boolean;
};
export type ChangePlan = {
  id: string;
  modelId: string;
  projectId: string;
  sessionId: string | null;
  member: string;
  by: "agent" | "person";
  framework: boolean;
  request: string;
  layers: PlanLayers;
  sections: Section[];
  status: "open" | "finished" | "stopped";
  current: string | null;
  phrases: string[];
  summary: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
};
export type PlanRow = {
  id: string;
  model_id: string;
  project_id: string;
  session_id: string | null;
  member: string;
  by_kind: "agent" | "person";
  framework: number;
  request: string;
  layers: string;
  sections: string;
  status: ChangePlan["status"];
  current: string | null;
  phrases: string;
  summary: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
};

const EMPTY: PlanLayers = {
  add: [],
  edit: [],
  remove: [],
  rename: [],
  follow: [],
  shared: false,
};
export function parsePlan(row: PlanRow): ChangePlan {
  return {
    id: row.id,
    modelId: row.model_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    member: row.member,
    by: row.by_kind,
    framework: row.framework === 1,
    request: row.request,
    layers: { ...EMPTY, ...(JSON.parse(row.layers) as Partial<PlanLayers>) },
    sections: JSON.parse(row.sections) as Section[],
    status: row.status,
    current: row.current,
    phrases: JSON.parse(row.phrases) as string[],
    summary: row.summary,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
  };
}

const now = () => new Date().toISOString();
const isStale = (plan: ChangePlan, at = Date.now()) =>
  at - Date.parse(plan.updatedAt) >= STALE_MS;
/** A stopped plan whose last activity was STALE_MS before it stopped stopped for inactivity. */
export const stoppedStale = (plan: ChangePlan) =>
  plan.status === "stopped" &&
  !!plan.endedAt &&
  isStale(plan, Date.parse(plan.endedAt));

async function stop(
  c: Context,
  plan: ChangePlan,
  reason: "inactive" | "session_ended",
) {
  const ended = await c.env.DB.prepare(
    "UPDATE change_plans SET status='stopped',ended_at=? WHERE id=? AND status='open'",
  )
    .bind(now(), plan.id)
    .run();
  if (ended.meta.changes !== 1) return false;
  await recordEvent(c, {
    projectId: plan.projectId,
    sessionId: plan.sessionId,
    kind: "change",
    payload: {
      type: "stopped",
      planId: plan.id,
      modelId: plan.modelId,
      reason,
    },
  });
  return true;
}

/** Stops the plan if it has been idle too long. Returns whether it is still open. */
export async function stopIfStale(c: Context, plan: ChangePlan) {
  if (plan.status !== "open") return false;
  if (!isStale(plan)) return true;
  await stop(c, plan, "inactive");
  plan.status = "stopped";
  plan.endedAt = now();
  return false;
}

/**
 * The model's open plan, after stopping it if it went stale. `stale` is the plan this call stopped
 * for inactivity, so a refusal can say why there is no open plan.
 */
export async function planState(
  c: Context,
  modelId: string,
): Promise<{ open: ChangePlan | null; stale: ChangePlan | null }> {
  const row = await c.env.DB.prepare(
    "SELECT * FROM change_plans WHERE model_id=? AND status='open'",
  )
    .bind(modelId)
    .first<PlanRow>();
  if (!row) return { open: null, stale: null };
  const plan = parsePlan(row);
  return (await stopIfStale(c, plan))
    ? { open: plan, stale: null }
    : { open: null, stale: plan };
}

/** Closes a stale open plan (recording a `change` event of type "stopped"), then returns the open plan or null. */
export async function openPlan(
  c: Context,
  modelId: string,
): Promise<ChangePlan | null> {
  return (await planState(c, modelId)).open;
}

export async function stopSessionPlans(
  c: Context,
  sessionId: string,
): Promise<number> {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM change_plans WHERE session_id=? AND status='open'",
  )
    .bind(sessionId)
    .all<PlanRow>();
  let stopped = 0;
  for (const row of results)
    if (await stop(c, parsePlan(row), "session_ended")) stopped++;
  return stopped;
}

/** Layer names the plan lets a write touch: add, edit, remove, both sides of rename; "Framework" if listed in edit. */
export function declared(layers: PlanLayers): Set<string> {
  return new Set([
    ...layers.add.map((l) => l.name),
    ...layers.edit,
    ...layers.remove,
    ...layers.rename.flatMap((r) => [r.from, r.to]),
  ]);
}
export const declaresFramework = (layers: PlanLayers) =>
  layers.edit.includes(RESERVED_LAYER);

/** Bumps the plan's last activity. */
export async function touchPlan(c: Context, planId: string): Promise<void> {
  await c.env.DB.prepare("UPDATE change_plans SET updated_at=? WHERE id=?")
    .bind(now(), planId)
    .run();
}

export const otherPlanMessage = (
  plan: Pick<ChangePlan, "startedAt" | "member">,
) => `started ${plan.startedAt} by ${plan.member}`;

/** The caller's plan, open and not stale, or a refusal saying what happened to it. */
export async function ownOpenPlan(
  c: Context,
  planId: string,
): Promise<ChangePlan> {
  const row = await c.env.DB.prepare("SELECT * FROM change_plans WHERE id=?")
    .bind(planId)
    .first<PlanRow>();
  if (!row || row.member !== c.identity.email || row.by_kind !== "agent")
    throw new AppError(404, "Change plan not found");
  const plan = parsePlan(row);
  await stopIfStale(c, plan);
  if (plan.status !== "open")
    throw new AppError(
      409,
      `This plan is ${plan.status}.${stoppedStale(plan) ? STALE_NOTE : ""}`,
    );
  return plan;
}
