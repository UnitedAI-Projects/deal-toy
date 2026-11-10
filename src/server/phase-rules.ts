/* The server's rules for a project's phase state: where its approvals are, and that only a person
   records one. The state's shape is the web app's PhaseState (src/web/phases.ts); the server
   checks the parts it must vouch for and stores the rest as given.

   An approval slot counts as approved whenever it holds any value, whatever its contents, so a
   value the server doesn't recognise as an approval can't slip past the agent guard and then be
   read as one by the interface. */
import { AppError } from "./core";

export type Stamp = { by: string; at: string };
type Json = Record<string, unknown>;

/** The documents a release is made of (src/web/phases.ts DOCS). */
export const DOC_KINDS = [
  "proof",
  "drawings",
  "parts",
  "assembly",
  "files",
  "inspection",
  "revisions",
] as const;
const QUESTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isObject = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);
const present = (v: unknown) => v !== undefined && v !== null;

/**
 * Refuses a state whose approval slots can't be read unambiguously: an approval that isn't an
 * object, documents outside the known kinds, and questions without a unique, simple id.
 */
export function checkShape(state: unknown) {
  if (!isObject(state))
    throw new AppError(400, "Phase state must be an object");
  const slot = (where: string, v: unknown) => {
    if (present(v) && !isObject(v))
      throw new AppError(400, `${where} must be an object or absent`);
  };
  if (present(state.brief) && !isObject(state.brief))
    throw new AppError(400, "brief must be an object");
  if (isObject(state.brief)) slot("brief.approved", state.brief.approved);
  slot("decision", state.decision);
  slot("modelReady", state.modelReady);
  slot("release", state.release);
  slot("order", state.order);
  if (present(state.docs)) {
    if (!isObject(state.docs))
      throw new AppError(400, "docs must be an object");
    for (const [kind, doc] of Object.entries(state.docs)) {
      if (!(DOC_KINDS as readonly string[]).includes(kind))
        throw new AppError(400, `Unknown document kind: ${kind.slice(0, 40)}`);
      if (present(doc) && !isObject(doc))
        throw new AppError(400, `docs.${kind} must be an object`);
      if (isObject(doc)) slot(`docs.${kind}.approved`, doc.approved);
    }
  }
  if (isObject(state.decision) && present(state.decision.questions)) {
    const qs = state.decision.questions;
    if (!Array.isArray(qs))
      throw new AppError(400, "decision.questions must be a list");
    const seen = new Set<string>();
    for (const q of qs) {
      if (!isObject(q) || typeof q.id !== "string" || !QUESTION_ID.test(q.id))
        throw new AppError(
          400,
          "Every question needs an id of letters, digits, - or _",
        );
      if (seen.has(q.id))
        throw new AppError(400, `Duplicate question id: ${q.id}`);
      seen.add(q.id);
      slot(`decision.questions.${q.id}.resolved`, q.resolved);
    }
  }
}

/**
 * Every approval in a state, keyed by where it is, with the object to stamp. Call checkShape
 * first: keys are then unique and every value is an object.
 */
export function approvals(state: unknown): Map<string, Json> {
  const out = new Map<string, Json>();
  if (!isObject(state)) return out;
  const add = (path: string, v: unknown) => {
    if (isObject(v)) out.set(path, v);
  };
  if (isObject(state.brief)) add("brief.approved", state.brief.approved);
  if (isObject(state.decision)) {
    add("decision", state.decision);
    const qs = state.decision.questions;
    if (Array.isArray(qs))
      for (const q of qs)
        if (isObject(q) && typeof q.id === "string")
          add(`decision.questions.${q.id}.resolved`, q.resolved);
  }
  add("modelReady", state.modelReady);
  add("release", state.release);
  add("order", state.order);
  if (isObject(state.docs))
    for (const [kind, doc] of Object.entries(state.docs))
      if (isObject(doc)) add(`docs.${kind}.approved`, doc.approved);
  return out;
}

/** What an approval decides. A decision's questions resolve one by one, so they are left out. */
function decided(path: string, v: Json | undefined) {
  if (!v) return "null";
  if (path === "decision") {
    const { questions: _questions, ...rest } = v;
    return JSON.stringify(rest);
  }
  return JSON.stringify(v);
}

/** Paths whose approval was added or changed between two states (removals are not included). */
export function changedApprovals(before: unknown, after: unknown): string[] {
  const was = approvals(before);
  return [...approvals(after)]
    .filter(
      ([path, now]) => decided(path, was.get(path)) !== decided(path, now),
    )
    .map(([path]) => path);
}

/** Paths whose approval was removed (a document reopened, a decision withdrawn). */
export function removedApprovals(before: unknown, after: unknown): string[] {
  const now = approvals(after);
  return [...approvals(before).keys()].filter((path) => !now.has(path));
}

/**
 * Writes who and when into every approval that changed: the signed-in person and the server's
 * clock, whatever the client sent. Stamps the objects themselves; mutates and returns the state.
 */
export function stamp(state: unknown, paths: string[], who: Stamp): unknown {
  const found = approvals(state);
  for (const path of paths) {
    const target = found.get(path);
    if (target) {
      target.by = who.by;
      target.at = who.at;
    }
  }
  return state;
}

/** Replaces approvers' emails for someone who may not see who did what. */
export function withoutPeople(state: unknown): unknown {
  if (!isObject(state)) return state;
  const copy = structuredClone(state);
  for (const target of approvals(copy).values())
    if ("by" in target) target.by = "";
  return copy;
}
