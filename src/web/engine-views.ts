/* Which engine a phase's professional view runs, and what it opens there: the phase's most recent
   working file, so switching views lands on what the person was working on. */
import type { Artifact, PhaseFile } from "./api";
import type { EngineId } from "./EngineFrame";
import type { PhaseId, PhaseState } from "./phases";

export const PHASE_ENGINE: Partial<Record<PhaseId, EngineId>> = {
  brief: "mantelpdf",
  art: "mantelart",
  concepts: "mantelmesh",
  model: "mantelcad",
  documents: "manteldocs",
};

export type ViewTarget = {
  engine: EngineId;
  phase: PhaseId;
  file?: { name: string; url: string; briefField?: string };
  conceptId?: string;
};

const newest = (files: PhaseFile[], phase: string, pattern: RegExp) =>
  [...files]
    .filter((f) => f.phase === phase && pattern.test(f.name))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

/** What the phase's engine opens when the person switches to it, or null for a phase without one. */
export function defaultTarget(
  phase: PhaseId,
  state: PhaseState,
  files: PhaseFile[],
  buildArtifacts: Artifact[],
): ViewTarget | null {
  const engine = PHASE_ENGINE[phase];
  if (!engine) return null;
  const artifact = (pattern: RegExp) => {
    const a = buildArtifacts.find((x) => pattern.test(x.name));
    return a ? { name: a.name, url: `/api/artifacts/${a.id}` } : undefined;
  };
  const file = (f?: PhaseFile) =>
    f ? { name: f.name, url: f.url } : undefined;
  switch (phase) {
    case "brief": {
      const pdf = [...state.brief.files]
        .reverse()
        .find((f) => f.url && /\.pdf$/i.test(f.name));
      return {
        engine,
        phase,
        file: pdf
          ? { name: pdf.name, url: pdf.url!, briefField: pdf.field }
          : undefined,
      };
    }
    case "art":
      return {
        engine,
        phase,
        file: file(newest(files, "art", /\.(vectorcraft|drawcraft|svg)$/i)),
      };
    case "concepts": {
      const c = [...state.concepts]
        .filter((x) => x.mesh && !x.discarded)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return c
        ? {
            engine,
            phase,
            file: { name: `${c.name}.mmesh`, url: c.mesh! },
            conceptId: c.id,
          }
        : { engine, phase };
    }
    case "model":
      return {
        engine,
        phase,
        file:
          file(newest(files, "model", /\.sc$/i)) ?? artifact(/\.(step|stp)$/i),
      };
    case "documents":
      return {
        engine,
        phase,
        file:
          file(newest(files, "documents", /\.dxf$/i)) ?? artifact(/\.dxf$/i),
      };
    default:
      return null;
  }
}
