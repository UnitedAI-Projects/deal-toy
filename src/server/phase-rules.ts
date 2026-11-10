/* The server's rules for a project's phase state: where its approvals are, and that only a person
   records one. The state's shape is the web app's PhaseState (src/web/phases.ts); the server
   checks the parts it must vouch for and stores the rest as given. */

export type Stamp = { by: string; at: string };
type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Every approval in a state, keyed by where it is, with the fields that make it a decision. */
export function approvals(state: unknown): Map<string, Json> {
  const out = new Map<string, Json>();
  if (!isObject(state)) return out;
  const add = (path: string, v: unknown) => {
    if (isObject(v) && typeof v.by === "string") out.set(path, v);
  };
  const brief = state.brief;
  if (isObject(brief)) add("brief.approved", brief.approved);
  const decision = state.decision;
  if (isObject(decision)) {
    // The decision itself is an approval, apart from its questions, which resolve one by one.
    const { questions, ...rest } = decision;
    add("decision", rest);
    if (Array.isArray(questions))
      questions.forEach((q, i) => {
        if (isObject(q))
          add(`decision.questions.${String(q.id ?? i)}.resolved`, q.resolved);
      });
  }
  add("modelReady", state.modelReady);
  add("release", state.release);
  add("order", state.order);
  const docs = state.docs;
  if (isObject(docs))
    for (const [kind, doc] of Object.entries(docs))
      if (isObject(doc)) add(`docs.${kind}.approved`, doc.approved);
  return out;
}

const same = (a: Json | undefined, b: Json | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Paths whose approval was added or changed between two states (removals are not included). */
export function changedApprovals(before: unknown, after: unknown): string[] {
  const was = approvals(before);
  return [...approvals(after)]
    .filter(([path, now]) => !same(was.get(path), now))
    .map(([path]) => path);
}

/** Paths whose approval was removed (a document reopened, a decision withdrawn). */
export function removedApprovals(before: unknown, after: unknown): string[] {
  const now = approvals(after);
  return [...approvals(before).keys()].filter((path) => !now.has(path));
}

/**
 * Writes who and when into every approval that changed: the signed-in person and the server's
 * clock, whatever the client sent. Mutates and returns the state.
 */
export function stamp(state: unknown, paths: string[], who: Stamp): unknown {
  if (!isObject(state)) return state;
  for (const path of paths) {
    const target = resolve(state, path);
    if (target) {
      target.by = who.by;
      target.at = who.at;
    }
  }
  return state;
}

function resolve(state: Json, path: string): Json | undefined {
  const parts = path.split(".");
  if (parts[0] === "decision" && parts.length === 1)
    return isObject(state.decision) ? state.decision : undefined;
  if (parts[0] === "decision" && parts[1] === "questions") {
    const d = state.decision;
    if (!isObject(d) || !Array.isArray(d.questions)) return undefined;
    const q = d.questions.find(
      (x, i) => isObject(x) && String(x.id ?? i) === parts[2],
    );
    return isObject(q) && isObject(q.resolved) ? q.resolved : undefined;
  }
  let at: unknown = state;
  for (const p of parts) at = isObject(at) ? at[p] : undefined;
  return isObject(at) ? at : undefined;
}

/** Replaces approvers' emails for someone who may not see who did what. */
export function withoutPeople(state: unknown): unknown {
  if (!isObject(state)) return state;
  const copy = structuredClone(state);
  for (const path of approvals(copy).keys()) {
    const target = resolve(copy, path);
    if (target) target.by = "";
  }
  return copy;
}
