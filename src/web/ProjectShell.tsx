/* A project in six phases. Model is the existing workspace with the phase bar and output
   bar passed in; the other phases share the frame in PhaseFrame. */
import { useEffect, useState } from "react";
import { can } from "./api";
import { ArtPhase } from "./ArtPhase";
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
import { ENGINE_NAMES, EngineFrame, type EngineId } from "./EngineFrame";
import {
  currentModel,
  defaultTarget,
  modelDesign,
  PHASE_ENGINE,
} from "./engine-views";
import { ApiError, call, type PhaseFile } from "./api";
import { latestBuild } from "./DocumentsPhase";
import { emptyPhaseState, withConceptSave } from "./phases";
import { normalize } from "./phase-store";
import { DemoBar, DemoFocus, useDemo } from "./DemoPlayer";
import type { DemoScript } from "../shared/demo";
import type { Turn } from "./PhaseAgent";

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
  openEngine: (
    engine: EngineId,
    phase: string,
    file?: EngineFile,
    conceptId?: string,
  ) => void;
  /** Bumped whenever an engine keeps a save, so file lists refresh. */
  filesVersion: number;
  /** A demo step's focus: the supplier thread (or other item) to show. */
  select?: string;
  /** During a demo: whether a stored file exists yet at this point of the story. */
  fileShown?: (file: PhaseFile) => boolean;
};
export type EngineFile = {
  name: string;
  url: string;
  briefField?: string;
};

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

/** The project as it stood at a demo step: revisions up to `revision`, and nobody's to edit. */
function asOf(data: WorkspaceProps["data"], revision: number) {
  const revisions = data.revisions.filter((r) => r.number <= revision);
  const ids = new Set(revisions.map((r) => r.id));
  const jobs = data.jobs.filter((j) => ids.has(j.revision_id));
  const jobIds = new Set(jobs.map((j) => j.id));
  return {
    ...data,
    // Playback is read-only everywhere: no one owns the project being shown.
    project: { ...data.project, owner: "demo-playback" },
    models: data.models.map((m) => ({
      ...m,
      revision: Math.min(m.revision, revision),
    })),
    revisions,
    jobs,
    artifacts: data.artifacts.filter((a) => jobIds.has(a.job_id)),
  };
}

export function ProjectShell(
  props: WorkspaceProps & {
    /** Open the project's recorded demo and play it. */
    playDemo?: boolean;
    onExitDemo?: () => void;
  },
) {
  const projectId = props.data.project.id;
  const [script, setScript] = useState<DemoScript | null>(null);
  useEffect(() => {
    if (!props.playDemo) {
      setScript(null);
      return;
    }
    call<{ script: DemoScript | null }>("demo_get", { projectId })
      .then((r) => setScript(r.script))
      .catch(() => setScript(null));
  }, [props.playDemo, projectId]);
  const demo = useDemo(script);
  const step = script ? demo.step : undefined;
  // What the project looks like right now: the step's result once its change has landed, until
  // then the previous step's (or a new project's, before the first).
  const shown = step
    ? demo.applied
      ? step
      : (script!.steps[demo.index - 1] ?? {
          state: emptyPhaseState(),
          revision: 0,
        })
    : undefined;
  const data = shown ? asOf(props.data, shown.revision) : props.data;
  const { me } = props;
  const owns = data.project.owner === me.email;
  const store = usePhases(projectId, props.data.project.owner === me.email);
  const latestRevision = Math.max(0, ...data.models.map((m) => m.revision));
  const [chosen, setPhase] = useState<PhaseId | null>(fromHash);
  // A project opens on the first phase not yet approved, once its phases have loaded.
  const phase = step
    ? step.phase
    : (chosen ??
      (store.state ? initialPhase(store.state, latestRevision) : null));
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
  // During a demo, choosing a phase jumps the demo there and it plays on.
  const go = (p: PhaseId) => (script ? demo.goPhase(p) : setPhase(p));
  const [engine, setEngine] = useState<{
    engine: EngineId;
    phase: string;
    file?: EngineFile;
    /** The concept MantelMesh saves belong to. */
    conceptId?: string;
  } | null>(null);
  const [filesVersion, setFilesVersion] = useState(0);
  // Each phase shows Mantel's simplified view or its engine's professional one. The engine stays
  // loaded while the person switches back, so its unsaved work and undo history survive.
  const [views, setViews] = useState<
    Partial<Record<PhaseId, "mantel" | "engine">>
  >({});
  const [engineDirty, setEngineDirty] = useState(false);
  const [allFiles, setAllFiles] = useState<PhaseFile[]>([]);
  useEffect(() => {
    call<{ files: PhaseFile[] }>("phase_files_list", { projectId })
      .then((r) => setAllFiles(r.files))
      .catch(() => setAllFiles([]));
  }, [projectId, filesVersion]);
  const openEngine = (
    e: EngineId,
    p: string,
    file?: EngineFile,
    conceptId?: string,
  ) => {
    const same =
      engine &&
      engine.engine === e &&
      engine.phase === p &&
      engine.file?.url === file?.url;
    if (
      !same &&
      engine &&
      engineDirty &&
      !confirm(
        `${ENGINE_NAMES[engine.engine]} has unsaved changes. Open something else anyway?`,
      )
    )
      return;
    if (!same) {
      setEngineDirty(false);
      setEngine({
        engine: e,
        phase: p,
        file,
        conceptId:
          conceptId ?? (e === "mantelmesh" ? crypto.randomUUID() : undefined),
      });
    }
    setViews((v) => ({ ...v, [p as PhaseId]: "engine" }));
  };
  const back = () => {
    history.replaceState(null, "", location.pathname);
    props.onBack();
  };
  if (props.playDemo && !script)
    return <div className="splash">Opening the demo…</div>;
  if (!store.state || !phase)
    return (
      <div className="splash">
        {store.error
          ? `Couldn't open the phases: ${store.error}`
          : "Opening the project…"}
      </div>
    );
  const { state, update } = step
    ? {
        state: normalize(shown!.state),
        update: (_: (s: PhaseState) => PhaseState) => {},
      }
    : { state: store.state, update: store.update };
  // A demo's conversation so far in each phase; the step now playing is typed out live.
  const demoTurns = (p: PhaseId) =>
    script
      ? {
          turns: script.steps
            .slice(0, demo.index + 1)
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => s.phase === p && s.kind === "agent")
            .map(({ s, i }): Turn => ({
              id: `demo-${i}`,
              prompt: s.prompt ?? "",
              response: s.response ?? "",
              status: "complete",
              actions: s.actions ?? [],
              model: s.model,
            })),
          live:
            step?.kind === "agent" && step.phase === p
              ? {
                  id: `demo-${demo.index}`,
                  startedAt: demo.startedAt,
                  ms: demo.duration,
                }
              : undefined,
        }
      : undefined;
  const demoLayer = step ? (
    <>
      <DemoFocus selector={step.focus} stepKey={demo.index} />
      <DemoBar
        demo={demo}
        onExit={() => {
          setScript(null);
          props.onExitDemo?.();
        }}
      />
    </>
  ) : null;
  /** A save from an engine: a new phase file, and for a brief attachment, a new attachment. */
  const kept = (file: PhaseFile) => {
    setFilesVersion((v) => v + 1);
    if (engine?.phase === "concepts") {
      update((s) => withConceptSave(s, file, engine.conceptId));
      return;
    }
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
  /** A design saved in MantelCAD becomes the model's next revision, built straight away. */
  const saveDesign = async (text: string) => {
    let model = currentModel(data)?.model;
    if (!model) {
      const created = await call<{ id: string; name: string }>(
        "models_create",
        { projectId, name: "Model 01" },
      );
      model = { id: created.id, name: created.name, revision: 0 };
    }
    const save = (expectedRevision: number) =>
      call<{ id: string; number: number }>("models_save", {
        modelId: model.id,
        expectedRevision,
        source: text,
      });
    let saved: { id: string; number: number };
    try {
      saved = await save(model.revision);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      // Someone (or the agent) saved a newer revision while this design was open.
      const latest = await call<{ model: { revision: number } | null }>(
        "model_get",
        { projectId, modelId: model.id },
      );
      const revision = latest.model?.revision ?? model.revision;
      if (
        !confirm(
          `Revision r${revision} was saved while you worked. Save your design as r${revision + 1} on top of it?`,
        )
      )
        throw new Error(`Not saved: r${revision} is newer`, { cause: error });
      saved = await save(revision);
    }
    await call("models_build", { revisionId: saved.id });
    await props.reload();
    return `Saved as revision r${saved.number}; building`;
  };
  const view = step ? "mantel" : (views[phase] ?? "mantel");
  const phaseEngine = PHASE_ENGINE[phase];
  const showEngine = view === "engine" && engine?.phase === phase;
  const showView = (next: "mantel" | "engine") => {
    if (next === "mantel")
      return setViews((v) => ({ ...v, [phase]: "mantel" }));
    if (engine?.phase === phase)
      return setViews((v) => ({ ...v, [phase]: "engine" }));
    const target = defaultTarget(
      phase,
      state,
      allFiles,
      latestBuild(data)?.artifacts ?? [],
      modelDesign(data),
    );
    if (target)
      openEngine(target.engine, target.phase, target.file, target.conceptId);
  };
  const viewSwitch = phaseEngine ? (
    <div className="view-switch" role="group" aria-label="View">
      <button
        className={view === "mantel" || !showEngine ? "on" : ""}
        aria-pressed={!showEngine}
        onClick={() => showView("mantel")}
        title="Mantel's simplified view of this phase"
      >
        Mantel
      </button>
      <button
        className={showEngine ? "on" : ""}
        aria-pressed={showEngine}
        onClick={() => showView("engine")}
        title={`The full ${ENGINE_NAMES[phaseEngine]} interface`}
      >
        {ENGINE_NAMES[phaseEngine]}
        {engineDirty && engine?.phase === phase && (
          <span className="dot-unsaved" aria-label="unsaved" />
        )}
      </button>
    </div>
  ) : null;
  const engineView = engine ? (
    <EngineFrame
      key={`${engine.engine}:${engine.file?.url ?? ""}`}
      engine={engine.engine}
      projectId={projectId}
      phase={engine.phase}
      file={engine.file}
      readOnly={!owns}
      visible={showEngine}
      onSaved={kept}
      onDirty={setEngineDirty}
      onClose={() => showView("mantel")}
      onSaveDesign={
        engine.engine === "mantelcad" && engine.phase === "model"
          ? saveDesign
          : undefined
      }
    />
  ) : null;
  const agentFor = (p: PhaseId) => (
    <PhaseAgent
      phase={p}
      state={state}
      latestRevision={latestRevision}
      projectId={projectId}
      canNote={owns && can(me, "notes.write")}
      playback={demoTurns(p)}
      onSuggestion={(text) => {
        if (text === "New artwork") {
          openEngine("mantelart", "art");
          return true;
        }
        const target = PHASES.find((x) => text === `Go to ${x.label}`);
        if (target) go(target.id);
        return !!target;
      }}
    />
  );
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
          data={data}
          reload={step ? async () => data : props.reload}
          onBack={back}
          phaseBar={phaseBar}
          topRight={viewSwitch}
          agentPanel={agentFor("model")}
          onOpenCad={step ? undefined : () => showView("engine")}
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
              projectId={projectId}
              data={data}
            />
          }
        />
        {engineView}
        {saveNote}
        {demoLayer}
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
    select: step?.select,
    // In a demo, a phase file shows once the state at this moment records it.
    fileShown: step
      ? (f: PhaseFile) =>
          f.phase !== "art" || f.name.replace(/\.[^.]+$/, "") in state.art.kinds
      : undefined,
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
        right={viewSwitch}
      />
      {agentFor(phase)}
      <main className="phase-work">
        {phase === "brief" && <BriefPhase {...shared} />}
        {phase === "art" && <ArtPhase {...shared} />}
        {phase === "concepts" && <ConceptsPhase {...shared} />}
        {phase === "documents" && <DocumentsPhase {...shared} />}
        {phase === "manufacture" && <ManufacturePhase {...shared} />}
      </main>
      {engineView}
      {saveNote}
      {demoLayer}
    </div>
  );
}

function ModelOutput(
  props: Omit<PhaseProps, "data" | "canDownload"> & {
    projectId: string;
    data: PhaseProps["data"];
  },
) {
  const { state, latestRevision } = props;
  const [open, setOpen] = useState(false);
  // What MantelCAD opens: the model's design, else (a legacy build123d model) its STEP.
  const step = latestBuild(props.data)?.artifacts.find((a) =>
    /\.(step|stp)$/i.test(a.name),
  );
  const cadFile =
    modelDesign(props.data) ??
    (step ? { name: step.name, url: `/api/artifacts/${step.id}` } : undefined);
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
        onClick={() => props.openEngine("mantelcad", "model", cadFile)}
        title={
          cadFile
            ? `Open ${cadFile.name} in MantelCAD`
            : "Open MantelCAD with a new design"
        }
      >
        Edit in MantelCAD
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
