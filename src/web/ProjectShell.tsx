/* A project in five phases. Model is the existing workspace with the phase bar and output
   bar passed in; the other phases share the frame in PhaseFrame. */
import { useEffect, useState } from "react";
import { can } from "./api";
import { BriefPhase } from "./BriefPhase";
import { ConceptsPhase } from "./ConceptsPhase";
import { DocumentsPhase } from "./DocumentsPhase";
import { ManufacturePhase } from "./ManufacturePhase";
import { OutputBar, PhaseAgent, PhaseBar, PhaseTopbar } from "./PhaseFrame";
import { usePhases } from "./phase-store";
import {
  approvedBriefVersion,
  phaseStatus,
  PHASES,
  type PhaseId,
  type PhaseState,
} from "./phases";
import { Workspace, type WorkspaceProps } from "./Workspace";
import { EngineFrame, type EngineId } from "./EngineFrame";
import type { PhaseFile } from "./api";

export type PhaseProps = {
  state: PhaseState;
  update: (fn: (s: PhaseState) => PhaseState) => void;
  data: WorkspaceProps["data"];
  email: string;
  readOnly: boolean;
  canDownload: boolean;
  latestRevision: number;
  go: (p: PhaseId) => void;
  /** Opens a phase engine over the project, with a file loaded; saves are filed under phase. */
  openEngine: (engine: EngineId, phase: string, file?: EngineFile) => void;
  /** Bumped whenever an engine keeps a save, so file lists refresh. */
  filesVersion: number;
};
export type EngineFile = { name: string; url: string; briefField?: string };

function fromHash(): PhaseId | null {
  const h = location.hash.slice(1);
  return PHASES.some((p) => p.id === h) ? (h as PhaseId) : null;
}

/** Where a project opens: the first phase whose output is not approved yet. */
export function initialPhase(s: PhaseState, latestRevision: number): PhaseId {
  const untouched =
    !s.brief.approved && s.brief.fields.every((f) => f.state === "open");
  if (untouched && latestRevision > 0) return "model";
  for (const p of PHASES)
    if (phaseStatus(s, p.id, latestRevision) !== "approved") return p.id;
  return "manufacture";
}

export function ProjectShell(props: WorkspaceProps) {
  const { data, me } = props;
  const projectId = data.project.id;
  const owns = data.project.owner === me.email;
  const store = usePhases(projectId, owns);
  const latestRevision = Math.max(0, ...data.models.map((m) => m.revision));
  const [chosen, setPhase] = useState<PhaseId | null>(fromHash);
  // A project opens on the first phase not yet approved, once its phases have loaded.
  const phase =
    chosen ?? (store.state ? initialPhase(store.state, latestRevision) : null);
  useEffect(() => {
    if (phase) history.replaceState(null, "", `#${phase}`);
  }, [phase]);
  useEffect(() => {
    const on = () => {
      const h = fromHash();
      if (h) setPhase(h);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = (p: PhaseId) => setPhase(p);
  const [engine, setEngine] = useState<{
    engine: EngineId;
    phase: string;
    file?: EngineFile;
  } | null>(null);
  const [filesVersion, setFilesVersion] = useState(0);
  const openEngine = (e: EngineId, p: string, file?: EngineFile) =>
    setEngine({ engine: e, phase: p, file });
  const back = () => {
    history.replaceState(null, "", location.pathname);
    props.onBack();
  };
  if (!store.state || !phase)
    return (
      <div className="splash">
        {store.error
          ? `Couldn't open the phases: ${store.error}`
          : "Opening the project…"}
      </div>
    );
  const { state, update } = store;
  /** A save from an engine: a new phase file, and for a brief attachment, a new attachment. */
  const kept = (file: PhaseFile) => {
    setFilesVersion((v) => v + 1);
    const field = engine?.file?.briefField;
    if (engine?.phase === "brief" && field)
      update((s) => ({
        ...s,
        brief: {
          ...s.brief,
          files: [
            ...s.brief.files,
            {
              id: file.id,
              name: file.name,
              type: file.media_type,
              size: file.size,
              field,
              url: file.url,
            },
          ],
        },
      }));
  };
  const engineView = engine ? (
    <EngineFrame
      key={`${engine.engine}:${engine.file?.url ?? ""}`}
      engine={engine.engine}
      projectId={projectId}
      phase={engine.phase}
      file={engine.file}
      readOnly={!owns}
      onSaved={kept}
      onClose={() => setEngine(null)}
    />
  ) : null;
  const phaseBar = (
    <PhaseBar
      state={state}
      phase={phase}
      latestRevision={latestRevision}
      onChoose={go}
    />
  );
  const saveNote = store.error ? (
    <div className="toast" role="alert">
      Not saved: {store.error}
    </div>
  ) : store.saving ? (
    <div className="save-chip" role="status">
      Saving…
    </div>
  ) : null;

  if (phase === "model")
    return (
      <>
        <Workspace
          {...props}
          onBack={back}
          phaseBar={phaseBar}
          outputBar={
            <ModelOutput
              state={state}
              update={update}
              email={me.email}
              readOnly={!owns}
              latestRevision={latestRevision}
              go={go}
              openEngine={openEngine}
              filesVersion={filesVersion}
            />
          }
        />
        {engineView}
        {saveNote}
      </>
    );

  const shared: PhaseProps = {
    state,
    update,
    data,
    email: me.email,
    readOnly: !owns,
    canDownload: owns || can(me, "exports.download"),
    latestRevision,
    go,
    openEngine,
    filesVersion,
  };
  return (
    <div className={`phase-page phase-${phase}`}>
      <PhaseTopbar
        projectName={data.project.name}
        demo={!owns}
        phaseBar={phaseBar}
        choice={props.themeChoice}
        chooseTheme={props.chooseTheme}
        onBack={back}
        onSettings={props.onSettings}
        onSignOut={props.onSignOut}
      />
      <PhaseAgent
        phase={phase}
        state={state}
        latestRevision={latestRevision}
        projectId={projectId}
        canNote={owns && can(me, "notes.write")}
        onSuggestion={(text) => {
          const target = PHASES.find((p) => text === `Go to ${p.label}`);
          if (target) go(target.id);
          return !!target;
        }}
      />
      <main className="phase-work">
        {phase === "brief" && <BriefPhase {...shared} />}
        {phase === "concepts" && <ConceptsPhase {...shared} />}
        {phase === "documents" && <DocumentsPhase {...shared} />}
        {phase === "manufacture" && <ManufacturePhase {...shared} />}
      </main>
      {engineView}
      {saveNote}
    </div>
  );
}

function ModelOutput(props: Omit<PhaseProps, "data" | "canDownload">) {
  const { state, latestRevision } = props;
  const [open, setOpen] = useState(false);
  const status = phaseStatus(state, "model", latestRevision);
  const questions = state.decision?.questions ?? [];
  const unresolved = questions.filter((q) => !q.resolved);
  return (
    <OutputBar>
      <span className="output-what">
        {latestRevision ? `Revision r${latestRevision}` : "No revision yet"}
      </span>
      <span className="output-facts">
        {!state.decision && <span>No concept chosen</span>}
        {questions.length > 0 && (
          <button className="link" onClick={() => setOpen(!open)}>
            {unresolved.length} open{" "}
            {unresolved.length === 1 ? "question" : "questions"} ▾
          </button>
        )}
        {status === "approved" && (
          <span>
            <span className="phase-ok">✓</span> Ready, marked by{" "}
            {state.modelReady!.by === props.email
              ? "you"
              : state.modelReady!.by}
          </span>
        )}
        {status === "stale" && (
          <span>
            <span className="phase-dot stale" /> r{state.modelReady!.revision}{" "}
            was marked ready; r{latestRevision} is newer
          </span>
        )}
      </span>
      <button
        className="secondary"
        onClick={() => props.openEngine("mantelcad", "model")}
        title="Open the model's engine"
      >
        Open in MantelCAD
      </button>
      <button
        disabled={props.readOnly || !latestRevision || status === "approved"}
        onClick={() =>
          props.update((s) => ({
            ...s,
            modelReady: {
              revision: latestRevision,
              briefVersion: approvedBriefVersion(s),
              by: props.email,
              at: new Date().toISOString(),
            },
          }))
        }
      >
        {status === "approved"
          ? "Ready for documents"
          : `Mark r${latestRevision || "–"} ready for documents`}
      </button>
      {open && (
        <div className="output-pop card">
          <strong>From the concept</strong>
          {questions.map((q) => (
            <label key={q.id} className="tick-row">
              <input
                type="checkbox"
                checked={!!q.resolved}
                disabled={props.readOnly}
                onChange={(e) =>
                  props.update((s) => ({
                    ...s,
                    decision: s.decision && {
                      ...s.decision,
                      questions: s.decision.questions.map((x) =>
                        x.id === q.id
                          ? {
                              ...x,
                              resolved: e.target.checked
                                ? {
                                    by: props.email,
                                    at: new Date().toISOString(),
                                  }
                                : undefined,
                            }
                          : x,
                      ),
                    },
                  }))
                }
              />
              <span className={q.resolved ? "done" : ""}>
                {q.text} <span className="tag">{q.owner}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </OutputBar>
  );
}
