/* A project's phase state, kept on the server (phases_get, phases_save) and followed live. Saves
   are debounced and versioned: if someone else saved first, their version is loaded and the
   person is told. Phase state saved in this browser before the server kept it is imported once,
   with its inline images moved to phase files. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  call,
  connectLive,
  uploadPhaseFile,
  type PhaseFile,
} from "./api";
import { emptyPhaseState, type PhaseState } from "./phases";

const key = (projectId: string) => `mantel.phases.v1.${projectId}`;
const SAVE_DELAY_MS = 700;

function local(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Saved state with any fields or documents the template gained since it was saved. */
export function normalize(saved: Partial<PhaseState> | null): PhaseState {
  const fresh = emptyPhaseState();
  if (!saved) return fresh;
  const fields = fresh.brief.fields.map(
    (f) => saved.brief?.fields?.find((x) => x.key === f.key) ?? f,
  );
  return {
    ...fresh,
    ...saved,
    brief: { ...fresh.brief, ...saved.brief, fields },
    docs: { ...fresh.docs, ...saved.docs },
  } as PhaseState;
}

/** The state this browser kept before the server did, or null. */
export function loadPhases(
  projectId: string,
  storage: Storage | undefined = local(),
): PhaseState | null {
  try {
    const raw = storage?.getItem(key(projectId));
    return raw ? normalize(JSON.parse(raw) as PhaseState) : null;
  } catch {
    return null;
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

export function forgetLocalPhases(
  projectId: string,
  storage: Storage | undefined = local(),
) {
  try {
    storage?.removeItem(key(projectId));
  } catch {
    // Nothing to forget.
  }
}

/** Every inline (data:) image in a state: brief files and concept images. */
export function inlineImages(
  s: PhaseState,
): { where: string; name: string; dataUrl: string }[] {
  return [
    ...s.brief.files
      .filter((f) => f.dataUrl?.startsWith("data:"))
      .map((f) => ({
        where: `file:${f.id}`,
        name: f.name,
        dataUrl: f.dataUrl!,
      })),
    ...s.concepts
      .filter((c) => c.image?.startsWith("data:"))
      .map((c) => ({
        where: `concept:${c.id}`,
        name: `${c.name || "concept"}.png`,
        dataUrl: c.image!,
      })),
  ];
}

/** Replaces inline images with the stored files' URLs. */
export function withFileUrls(
  s: PhaseState,
  urls: Map<string, string>,
): PhaseState {
  return {
    ...s,
    brief: {
      ...s.brief,
      files: s.brief.files.map((f) =>
        urls.has(`file:${f.id}`)
          ? { ...f, url: urls.get(`file:${f.id}`), dataUrl: undefined }
          : f,
      ),
    },
    concepts: s.concepts.map((c) =>
      urls.has(`concept:${c.id}`)
        ? { ...c, image: urls.get(`concept:${c.id}`) }
        : c,
    ),
  };
}

function blobOf(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",", 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function importLocal(projectId: string, s: PhaseState) {
  const urls = new Map<string, string>();
  for (const img of inlineImages(s)) {
    const phase = img.where.startsWith("concept:") ? "concepts" : "brief";
    const file: PhaseFile = await uploadPhaseFile(
      projectId,
      phase,
      img.name,
      blobOf(img.dataUrl),
    );
    urls.set(img.where, file.url);
  }
  return withFileUrls(s, urls);
}

type Got = { state: PhaseState | null; version: number };
export type PhaseStore = {
  /** null until the server's state has loaded. */
  state: PhaseState | null;
  update: (fn: (s: PhaseState) => PhaseState) => void;
  /** "" when everything is saved. */
  error: string;
  saving: boolean;
};

export function usePhases(projectId: string, canWrite: boolean): PhaseStore {
  const [state, setState] = useState<PhaseState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const version = useRef(0);
  const dirty = useRef(0); // local edits not yet sent
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<PhaseState | null>(null);

  const load = useCallback(async () => {
    const got = await call<Got>("phases_get", { projectId });
    version.current = got.version;
    const s = normalize(got.state);
    latest.current = s;
    setState(s);
    return got;
  }, [projectId]);

  const flush = useCallback(async () => {
    if (!canWrite || inFlight.current || !dirty.current || !latest.current)
      return;
    inFlight.current = true;
    const sent = dirty.current;
    setSaving(true);
    try {
      const r = await call<{ version: number; state: PhaseState }>(
        "phases_save",
        { projectId, expectedVersion: version.current, state: latest.current },
      );
      version.current = r.version;
      // Adopt the server's copy (it stamps approvals) unless more edits came in meanwhile.
      if (dirty.current === sent) {
        dirty.current = 0;
        latest.current = normalize(r.state);
        setState(latest.current);
      } else dirty.current -= sent;
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        dirty.current = 0;
        await load();
        setError(
          "Someone else saved this project's phases first. Their version is shown; your last change was not saved.",
        );
      } else setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
      if (dirty.current)
        timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    }
  }, [canWrite, load, projectId]);

  useEffect(() => {
    let stop = () => {};
    let gone = false;
    void (async () => {
      try {
        const got = await load();
        // State this browser kept before the server did moves to the server once.
        const old = loadPhases(projectId);
        if (canWrite && got.version === 0 && old) {
          const imported = await importLocal(projectId, old);
          const r = await call<{ version: number; state: PhaseState }>(
            "phases_save",
            { projectId, expectedVersion: 0, state: imported },
          );
          version.current = r.version;
          latest.current = normalize(r.state);
          setState(latest.current);
          forgetLocalPhases(projectId);
        }
      } catch (e) {
        setError((e as Error).message);
        setState((s) => s ?? normalize(null));
      }
      if (gone) return;
      stop = connectLive(
        projectId,
        (m) => {
          if (
            m.type === "phases" &&
            m.version > version.current &&
            !dirty.current &&
            !inFlight.current
          )
            void load().catch(() => {});
        },
        () => {},
      );
    })();
    return () => {
      gone = true;
      stop();
      clearTimeout(timer.current);
    };
  }, [projectId, canWrite, load]);

  const update = useCallback(
    (fn: (s: PhaseState) => PhaseState) => {
      if (!latest.current) return;
      latest.current = fn(latest.current);
      setState(latest.current);
      if (!canWrite) return;
      dirty.current += 1;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [canWrite, flush],
  );
  return { state, update, error, saving };
}
