import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  call,
  connectLive,
  download,
  saveBlob,
  type Activity,
  type Facts,
  type Me,
  type ParamSpec,
  type Revision,
  type Workspace as WorkspaceData,
} from "./api";
import { ChatPanel } from "./ChatPanel";
import { diffLines } from "./diff";
import type { ThemeChoice } from "./theme";
import sample from "../../examples/bridge.py?raw";
const Viewer = lazy(() =>
  import("./Viewer").then((module) => ({ default: module.Viewer })),
);
const briefTemplate = `# Manufacturing brief — DRAFT\n\nQuantity: TBD\nMaterial and grade: TBD\nProcess: TBD with manufacturer\nFinish and colour: TBD\nCritical dimensions and tolerances: TBD\nArtwork and engraving: TBD\nAssembly and adhesives: TBD\nInspection and sample approval: Required\nPackaging and shipping: TBD\n\nOpen questions:\n- Confirm process and supplier capabilities.\n- Review dimensioned engineering drawings.\n- Approve a physical sample before batch production.\n`;
type Drawer = "code" | "downloads" | "documents" | "connect" | null;
type Props = {
  data: WorkspaceData;
  reload: () => Promise<WorkspaceData>;
  me: Me;
  theme: "light" | "dark";
  themeChoice: ThemeChoice;
  chooseTheme: (choice: ThemeChoice) => void;
  onBack: () => void;
  onExtensions: () => void;
  onSignOut: () => void;
};
export function Workspace(props: Props) {
  const { data } = props;
  const projectId = data.project.id;
  const [activity, setActivity] = useState<Activity>({
    sessions: [],
    events: [],
  });
  const [connected, setConnected] = useState(false);
  const [modelId, setModelId] = useState(data.models[0]?.id ?? "");
  const [follow, setFollow] = useState(true);
  const [viewNumber, setViewNumber] = useState(0);
  const [selection, setSelection] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [menu, setMenu] = useState(false);
  const [chatOpen, setChatOpen] = useState(
    () => !matchMedia("(max-width: 760px)").matches,
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const refresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function loadActivity() {
    setActivity(await call<Activity>("projects_activity", { projectId }));
  }
  useEffect(() => {
    void loadActivity().catch((e: Error) => setError(e.message));
    const stop = connectLive(
      projectId,
      (message) => {
        if (message.type === "event")
          setActivity((current) => {
            if (current.events.some((e) => e.id === message.event.id))
              return current;
            const events = [...current.events, message.event];
            const kind = message.event.kind;
            // Session state (active, ended, title) comes from the server on these changes.
            if (kind === "prompt" || kind === "ended") void loadActivity();
            return {
              sessions: current.sessions.map((s) =>
                s.id === message.event.session_id
                  ? { ...s, last_event_at: message.event.created_at }
                  : s,
              ),
              events,
            };
          });
        else {
          clearTimeout(refresh.current);
          refresh.current = setTimeout(
            () => void props.reload().catch(() => {}),
            250,
          );
        }
      },
      (open) => {
        setConnected(open);
        // Fill any gap from while the socket was down.
        if (open) void loadActivity().catch(() => {});
      },
    );
    return () => {
      stop();
      clearTimeout(refresh.current);
    };
  }, [projectId]);
  useEffect(() => {
    if (!data.models.some((m) => m.id === modelId) && data.models[0])
      setModelId(data.models[0].id);
  }, [data.models, modelId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu((open) => !open);
      } else if (e.key === "Escape") {
        if (menu) setMenu(false);
        else if (selection) setSelection(null);
        else if (drawer) setDrawer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, selection, drawer]);

  const model = data.models.find((m) => m.id === modelId);
  const revisions = useMemo(
    () =>
      data.revisions
        .filter((r) => r.model_id === modelId)
        .sort((a, b) => a.number - b.number),
    [data.revisions, modelId],
  );
  const jobsFor = (r?: Revision) =>
    r ? data.jobs.filter((j) => j.revision_id === r.id) : [];
  const built = (r?: Revision) =>
    jobsFor(r).find((j) => j.status === "succeeded");
  const latest = revisions.at(-1);
  const viewed = follow
    ? latest
    : (revisions.find((r) => r.number === viewNumber) ?? latest);
  // Show the newest revision at or before the viewed one that has a model to display.
  const shown = [...revisions]
    .reverse()
    .find((r) => viewed && r.number <= viewed.number && built(r));
  const shownJob = built(shown);
  const facts: Facts | null = shownJob?.facts
    ? JSON.parse(shownJob.facts)
    : null;
  const artifacts = data.artifacts.filter((a) => a.job_id === shownJob?.id);
  const glb = artifacts.find((a) => a.name === "model.glb");
  const viewedJob = jobsFor(viewed)[0];
  const parts = facts?.parts?.map((p) => p.label).filter(Boolean) ?? [];
  const params = Object.entries(facts?.params ?? {});
  const running = activity.sessions.find((s) => s.active && !s.ended_at);
  const lastSession = activity.sessions[0];
  const editable =
    !!latest &&
    shown?.id === latest.id &&
    viewed?.id === latest.id &&
    !!shownJob;

  function viewRevision(r: Revision) {
    setFollow(r.id === latest?.id);
    setViewNumber(r.number);
    setSelection(null);
    if (r.model_id !== modelId) setModelId(r.model_id);
  }
  async function sendNote(text: string) {
    await call("notes_add", { projectId, message: text });
  }
  function askAboutPart(label: string, specs: [string, ParamSpec][]) {
    const values = specs.map(
      ([n, s]) => `${n} ${s.value}${s.unit ? ` ${s.unit}` : ""}`,
    );
    setDraft(
      `About the ${label}${values.length ? ` (${values.join(", ")})` : ""}: `,
    );
    setSelection(null);
    setChatOpen(true);
    setTimeout(() => composer.current?.focus(), 0);
  }

  const status = running
    ? `Agent working${latest ? ` · revision ${latest.number}` : ""}`
    : lastSession?.ended_at
      ? "Agent finished"
      : activity.events.length
        ? "Agent idle"
        : "No agent yet";
  return (
    <div className="workspace">
      <Suspense fallback={<div className="viewer" />}>
        <Viewer
          artifactId={glb?.id}
          modelKey={modelId}
          theme={props.theme}
          parts={parts}
          selected={selection?.label ?? null}
          onSelect={(label, point) =>
            setSelection(label ? { label, ...point } : null)
          }
        />
      </Suspense>

      <header className="topbar">
        <div className="topbar-left">
          <button
            className="chip brand"
            onClick={props.onBack}
            title="All projects"
          >
            <span className="mark" aria-hidden="true" />
            Mantel
          </button>
          <span className="chip project-name">{data.project.name}</span>
          {data.models.length > 1 && (
            <select
              className="chip"
              aria-label="Model"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setFollow(true);
                setSelection(null);
              }}
            >
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="topbar-right">
          <span
            className="chip status"
            title={connected ? "Live" : "Reconnecting…"}
          >
            <span
              className={`dot ${running ? "on" : ""} ${connected ? "" : "offline"}`}
            />
            <span className="status-text">
              {connected ? status : "Reconnecting…"}
            </span>
          </span>
          <button
            className="chip icon"
            aria-label="Menu"
            aria-expanded={menu}
            title="Menu (⌘K)"
            onClick={() => setMenu(!menu)}
          >
            ⋯
          </button>
        </div>
        {menu && (
          <Menu
            onClose={() => setMenu(false)}
            choice={props.themeChoice}
            chooseTheme={props.chooseTheme}
            open={(d) => {
              setDrawer(d);
              setMenu(false);
            }}
            onExtensions={props.onExtensions}
            onSignOut={props.onSignOut}
          />
        )}
      </header>

      <div className={`chat-shell ${chatOpen ? "open" : ""}`}>
        <button className="chat-toggle" onClick={() => setChatOpen(!chatOpen)}>
          {chatOpen ? "Hide activity" : "Agent activity"}
          {running && <span className="dot on" />}
        </button>
        {chatOpen && (
          <ChatPanel
            activity={activity}
            revisions={data.revisions}
            jobs={data.jobs}
            me={props.me.email}
            draft={draft}
            setDraft={setDraft}
            composer={composer}
            onSend={sendNote}
            onViewRevision={viewRevision}
          />
        )}
      </div>

      {!data.models.length && (
        <div className="canvas-empty">
          <span className="mark large" aria-hidden="true" />
          <h2>Start with your agent</h2>
          <p>
            Connect an MCP client to this workspace and prompt it with the
            project. Its work appears here live.
          </p>
          <div className="row">
            <button onClick={() => setDrawer("connect")}>
              Connect an agent
            </button>
            <button className="secondary" onClick={() => setDrawer("code")}>
              Write the model yourself
            </button>
          </div>
        </div>
      )}

      {selection && (
        <PartPopover
          key={`${selection.label}-${shown?.id}`}
          label={selection.label}
          at={selection}
          params={params.filter(([, s]) => s.part === selection.label)}
          editable={editable}
          building={
            viewedJob?.status === "queued" || viewedJob?.status === "running"
          }
          onClose={() => setSelection(null)}
          onAsk={(specs) => askAboutPart(selection.label, specs)}
          onApply={async (name, value) => {
            if (!model || !latest) return;
            await call("models_set_parameter", {
              modelId: model.id,
              expectedRevision: latest.number,
              name,
              value,
            });
            setFollow(true);
            await props.reload();
          }}
        />
      )}

      {viewedJob?.status === "failed" && (
        <div className="build-banner" role="alert">
          <strong>Revision {viewed?.number} failed to build.</strong>
          <span>{viewedJob.error?.split("\n").at(-2) ?? viewedJob.error}</span>
          <button className="link" onClick={() => setDrawer("code")}>
            View code
          </button>
        </div>
      )}

      {!!revisions.length && (
        <nav className="revisions" aria-label="Revisions">
          {revisions.slice(-12).map((r) => {
            const job = jobsFor(r)[0];
            return (
              <button
                key={r.id}
                className={`pill ${viewed?.id === r.id ? "on" : ""}`}
                onClick={() => viewRevision(r)}
                title={job ? `Build ${job.status}` : "Not built"}
              >
                <span className={`state ${job?.status ?? "none"}`} />r{r.number}
              </button>
            );
          })}
          {!follow && (
            <button className="pill follow" onClick={() => setFollow(true)}>
              Follow live
            </button>
          )}
        </nav>
      )}

      {drawer && (
        <aside className="drawer" aria-label={drawer}>
          <div className="drawer-head">
            <h2>
              {
                {
                  code: "Source code",
                  downloads: "Downloads and facts",
                  documents: "Manufacturing documents",
                  connect: "Connect an agent",
                }[drawer]
              }
            </h2>
            <button
              className="icon ghost"
              aria-label="Close"
              onClick={() => setDrawer(null)}
            >
              ×
            </button>
          </div>
          <div className="drawer-body">
            {drawer === "code" && (
              <CodeDrawer
                key={`${modelId}-${viewed?.id}`}
                revision={viewed}
                previous={revisions.find(
                  (r) => r.number === (viewed?.number ?? 0) - 1,
                )}
                error={viewedJob?.status === "failed" ? viewedJob.error : null}
                onSave={async (source, build) => {
                  let id = model?.id;
                  if (!id)
                    id = (
                      await call<{ id: string }>("models_create", {
                        projectId,
                        name: "Model 01",
                      })
                    ).id;
                  const saved = await call<{ id: string }>("models_save", {
                    modelId: id,
                    expectedRevision: model?.revision ?? 0,
                    source,
                  });
                  if (build)
                    await call("models_build", { revisionId: saved.id });
                  setModelId(id);
                  setFollow(true);
                  await props.reload();
                }}
              />
            )}
            {drawer === "downloads" && (
              <div className="stack">
                {shown ? (
                  <p className="muted">
                    Revision {shown.number}. Exports always belong to one saved
                    revision.
                  </p>
                ) : (
                  <p className="muted">No built revision yet.</p>
                )}
                <div className="downloads">
                  {artifacts.map((a) => (
                    <button
                      key={a.id}
                      className="secondary"
                      onClick={() =>
                        void download(a.id, a.name).catch((e: Error) =>
                          setError(e.message),
                        )
                      }
                    >
                      ↓ {a.name}
                    </button>
                  ))}
                </div>
                {facts && (
                  <dl className="facts">
                    <dt>Size</dt>
                    <dd>
                      {facts.bounds.map((n) => n.toFixed(1)).join(" × ")} mm
                    </dd>
                    <dt>Solids</dt>
                    <dd>{facts.solids}</dd>
                    <dt>Volume</dt>
                    <dd title="Sum of part volumes; overlapping parts count twice">
                      {Math.round(facts.volume_mm3).toLocaleString()} mm³
                    </dd>
                    {facts.parts?.map((p) => (
                      <div className="fact-row" key={p.label}>
                        <dt>{p.label || "Unlabelled part"}</dt>
                        <dd>{Math.round(p.volume_mm3).toLocaleString()} mm³</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="muted">
                  A valid solid is not a manufacturing approval. Drawings, DFM
                  and a sample approval are separate reviews.
                </p>
              </div>
            )}
            {drawer === "documents" && (
              <Documents
                data={data}
                revisionId={shown?.id}
                reload={props.reload}
              />
            )}
            {drawer === "connect" && <Connect />}
          </div>
        </aside>
      )}

      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="link" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function Menu(props: {
  onClose: () => void;
  open: (d: Drawer) => void;
  choice: ThemeChoice;
  chooseTheme: (c: ThemeChoice) => void;
  onExtensions: () => void;
  onSignOut: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="menu" role="menu">
      <button ref={first} role="menuitem" onClick={() => props.open("code")}>
        Source code <kbd>diff</kbd>
      </button>
      <button role="menuitem" onClick={() => props.open("downloads")}>
        Downloads and facts
      </button>
      <button role="menuitem" onClick={() => props.open("documents")}>
        Manufacturing documents
      </button>
      <button role="menuitem" onClick={() => props.open("connect")}>
        Connect an agent
      </button>
      <hr />
      <button
        role="menuitem"
        onClick={() => {
          props.onClose();
          props.onExtensions();
        }}
      >
        Skills and tools
      </button>
      <div className="segmented" role="group" aria-label="Theme">
        {(["system", "light", "dark"] as const).map((c) => (
          <button
            key={c}
            className={props.choice === c ? "on" : ""}
            aria-pressed={props.choice === c}
            onClick={() => props.chooseTheme(c)}
          >
            {c === "system" ? "Auto" : c === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <hr />
      <button role="menuitem" onClick={props.onSignOut}>
        Sign out
      </button>
    </div>
  );
}

function PartPopover(props: {
  label: string;
  at: { x: number; y: number };
  params: [string, ParamSpec][];
  editable: boolean;
  building: boolean;
  onClose: () => void;
  onAsk: (specs: [string, ParamSpec][]) => void;
  onApply: (name: string, value: number) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.params.map(([n, s]) => [n, String(s.value)])),
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function apply(name: string, spec: ParamSpec) {
    const value = Number(values[name]);
    if (!Number.isFinite(value)) return setError("Enter a number");
    if (value === spec.value) return;
    setBusy(name);
    setError("");
    try {
      await props.onApply(name, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Change was not saved");
    } finally {
      setBusy("");
    }
  }
  const style = {
    left: `min(max(12px, ${props.at.x + 16}px), calc(100% - 308px))`,
    top: `min(max(64px, ${props.at.y - 40}px), calc(100% - 320px))`,
  };
  return (
    <div
      className="popover"
      style={style}
      role="dialog"
      aria-label={`${props.label} dimensions`}
    >
      <div className="popover-head">
        <strong>{props.label}</strong>
        <button
          className="icon ghost"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      {!props.params.length && (
        <p className="muted small">
          No editable dimensions are declared for this part.
        </p>
      )}
      {props.params.map(([name, spec]) => (
        <label className="param" key={name}>
          <span>{name}</span>
          <span className="param-field">
            <input
              inputMode="decimal"
              value={values[name] ?? ""}
              disabled={!props.editable || props.building || !!busy}
              onChange={(e) => setValues({ ...values, [name]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void apply(name, spec);
              }}
              onBlur={() => void apply(name, spec)}
              aria-describedby={`${name}-range`}
            />
            <span className="unit">{spec.unit ?? ""}</span>
          </span>
          {(spec.min !== undefined || spec.max !== undefined) && (
            <small id={`${name}-range`} className="muted">
              {spec.min ?? "…"}–{spec.max ?? "…"}
            </small>
          )}
        </label>
      ))}
      {!props.editable && !!props.params.length && (
        <p className="muted small">
          Viewing an older revision. Follow live to edit.
        </p>
      )}
      {props.building && (
        <p className="muted small">
          A build is running; edit when it finishes.
        </p>
      )}
      {busy && <p className="muted small">Saving and rebuilding…</p>}
      {error && (
        <p className="inline-error small" role="alert">
          {error}
        </p>
      )}
      <button className="ask" onClick={() => props.onAsk(props.params)}>
        ✦ Ask the agent to change this part…
      </button>
    </div>
  );
}

function CodeDrawer(props: {
  revision?: Revision;
  previous?: Revision;
  error: string | null;
  onSave: (source: string, build: boolean) => Promise<void>;
}) {
  const original = props.revision?.source ?? sample;
  const [source, setSource] = useState(original);
  const [mode, setMode] = useState<"view" | "edit" | "diff">(
    props.revision ? "view" : "edit",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = source !== original;
  const diff =
    props.previous && mode === "diff"
      ? diffLines(props.previous.source ?? "", original)
      : null;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(build: boolean) {
    setBusy(true);
    setError("");
    try {
      await props.onSave(source, build);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Code view">
        <button
          className={mode === "view" ? "on" : ""}
          onClick={() => setMode("view")}
          disabled={!props.revision}
        >
          {props.revision ? `Revision ${props.revision.number}` : "New"}
        </button>
        <button
          className={mode === "diff" ? "on" : ""}
          onClick={() => setMode("diff")}
          disabled={!props.previous}
        >
          Changes
        </button>
        <button
          className={mode === "edit" ? "on" : ""}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>
      </div>
      {props.error && <pre className="code error-block">{props.error}</pre>}
      {mode === "view" && <pre className="code">{original}</pre>}
      {mode === "diff" &&
        (diff ? (
          <pre className="code diff">
            {diff.map((line, i) => (
              <span key={i} className={line.kind}>
                {line.kind === "add"
                  ? "+ "
                  : line.kind === "remove"
                    ? "− "
                    : "  "}
                {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
        ) : (
          <p className="muted">This change is too large to compare here.</p>
        ))}
      {mode === "edit" && (
        <>
          <textarea
            className="code editor"
            spellCheck={false}
            aria-label="Python model source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <p className="muted small">
            Define <code>build()</code> and return build123d parts. Units: mm.
            Saving creates a new revision; it never overwrites one.
          </p>
          <div className="row">
            <button
              className="secondary"
              disabled={busy || (!dirty && !!props.revision)}
              onClick={() => void save(false)}
            >
              Save revision
            </button>
            <button
              disabled={busy || (!dirty && !!props.revision)}
              onClick={() => void save(true)}
            >
              Save and build
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Documents(props: {
  data: WorkspaceData;
  revisionId?: string;
  reload: () => Promise<WorkspaceData>;
}) {
  const [content, setContent] = useState(briefTemplate);
  const [revisionId, setRevisionId] = useState(props.revisionId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data } = props;
  return (
    <div className="stack">
      <p className="muted">
        Record materials, finishes, tolerances, assembly and inspection needs.
        New entries keep previous versions.
      </p>
      <label>
        Revision
        <select
          value={revisionId}
          onChange={(e) => setRevisionId(e.target.value)}
        >
          <option value="">Whole project</option>
          {data.revisions.map((r) => (
            <option key={r.id} value={r.id}>
              {data.models.find((m) => m.id === r.model_id)?.name} · revision{" "}
              {r.number}
            </option>
          ))}
        </select>
      </label>
      <textarea
        className="code editor short"
        value={content}
        maxLength={30000}
        onChange={(e) => setContent(e.target.value)}
      />
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          call("documents_add", {
            projectId: data.project.id,
            revisionId: revisionId || undefined,
            kind: "manufacturing-brief",
            title: "Manufacturing brief",
            content,
          })
            .then(() => props.reload())
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Save draft brief
      </button>
      {error && <p className="inline-error">{error}</p>}
      {data.documents.map((d) => (
        <article className="doc" key={d.id}>
          <div className="doc-head">
            <strong>{d.title}</strong>
            <span className="tag">Draft · v{d.version}</span>
          </div>
          <p className="muted small">
            {d.model_revision_id
              ? `Revision ${data.revisions.find((r) => r.id === d.model_revision_id)?.number}`
              : "Whole project"}
          </p>
          <pre>{d.content}</pre>
          <div className="row">
            <button className="secondary" onClick={() => setContent(d.content)}>
              Use as next draft
            </button>
            <button
              className="ghost"
              onClick={() =>
                saveBlob(
                  new Blob([d.content], {
                    type: "text/markdown;charset=utf-8",
                  }),
                  `${d.kind}-v${d.version}.md`,
                )
              }
            >
              Download
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Connect() {
  return (
    <div className="stack">
      <p>
        Connect any MCP client that supports Streamable HTTP with a bearer
        token, such as Claude Code.
      </p>
      <label>
        Server URL
        <input
          readOnly
          value={`${location.origin}/mcp`}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <p className="muted">
        Use your administrator-issued personal token as the{" "}
        <code>Authorization: Bearer</code> header, kept in the client's secret
        store.
      </p>
      <pre className="code">{`session_start  → your prompt appears here
session_update → short progress notes
models_save → models_build → builds_get
session_end    → a summary of the result`}</pre>
      <p className="muted small">
        The agent reads the modeling skill with <code>skills_list</code>. Notes
        you leave here reach it on its next tool call. Clients that require
        OAuth need the planned OAuth adapter.
      </p>
    </div>
  );
}
