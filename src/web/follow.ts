import type { Workspace } from "./api";

/** The newest revision save or build update for each model that has one (ISO timestamps). */
function lastChange(data: Workspace) {
  const modelOf = new Map(data.revisions.map((r) => [r.id, r.model_id]));
  const latest = new Map<string, string>();
  const touch = (model: string | undefined, at: string | undefined) => {
    if (model && at && at > (latest.get(model) ?? "")) latest.set(model, at);
  };
  for (const r of data.revisions) touch(r.model_id, r.created_at);
  for (const j of data.jobs) touch(modelOf.get(j.revision_id), j.updated_at);
  return latest;
}

/** The model a workspace opens on: the one changed most recently, else the first. */
export function initialModel(data: Workspace) {
  let pick = data.models[0]?.id ?? "";
  let newest = "";
  for (const [model, at] of lastChange(data))
    if (at > newest && data.models.some((m) => m.id === model)) {
      pick = model;
      newest = at;
    }
  return pick;
}

/**
 * The model that changed between two snapshots of a workspace: a newly created model, or the
 * one with the newest revision or build update. Undefined when nothing changed.
 */
export function changedModel(before: Workspace, after: Workspace) {
  const known = new Set(before.models.map((m) => m.id));
  const created = after.models.find((m) => !known.has(m.id));
  if (created) return created.id;
  const previous = lastChange(before);
  let pick: string | undefined;
  let newest = "";
  for (const [model, at] of lastChange(after))
    if (at > (previous.get(model) ?? "") && at > newest) {
      pick = model;
      newest = at;
    }
  return pick;
}
