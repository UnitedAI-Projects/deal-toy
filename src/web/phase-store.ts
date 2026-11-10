/* Keeps each project's phase state in this browser. A stand-in until the phases have a
   server-side data model: it is per browser, and a save can fail (private windows, full
   storage), which the caller shows rather than hides. */
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyPhaseState, type PhaseState } from "./phases";

const key = (projectId: string) => `mantel.phases.v1.${projectId}`;

function local(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadPhases(
  projectId: string,
  storage: Storage | undefined = local(),
): PhaseState {
  const fresh = emptyPhaseState();
  try {
    const raw = storage?.getItem(key(projectId));
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as PhaseState;
    // Keep saved answers, and add any fields or documents the template gained since.
    const fields = fresh.brief.fields.map(
      (f) => saved.brief?.fields?.find((x) => x.key === f.key) ?? f,
    );
    return {
      ...fresh,
      ...saved,
      brief: { ...fresh.brief, ...saved.brief, fields },
      docs: { ...fresh.docs, ...saved.docs },
    };
  } catch {
    return fresh;
  }
}

export function savePhases(
  projectId: string,
  s: PhaseState,
  storage: Storage | undefined = local(),
): { ok: true } | { ok: false; reason: string } {
  if (!storage) return { ok: false, reason: "This browser has no storage" };
  try {
    storage.setItem(key(projectId), JSON.stringify(s));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** State, an updater that saves, and the last save error ("" when saved). */
export function usePhases(
  projectId: string,
): [PhaseState, (fn: (s: PhaseState) => PhaseState) => void, string] {
  const [state, setState] = useState(() => loadPhases(projectId));
  const [error, setError] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const r = savePhases(projectId, state);
    setError(r.ok ? "" : r.reason);
  }, [projectId, state]);
  const update = useCallback(
    (fn: (s: PhaseState) => PhaseState) => setState((s) => fn(s)),
    [],
  );
  return [state, update, error];
}
