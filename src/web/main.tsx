import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  call,
  download,
  saveBlob,
  request,
  tokenKey,
  type Artifact,
  type Project,
  type Skill,
  type Tool,
  type Workspace,
} from "./api";
const Viewer = lazy(() =>
  import("./Viewer").then((module) => ({ default: module.Viewer })),
);
import sample from "../../examples/bridge.py?raw";
import "./style.css";
const briefTemplate = `# Manufacturing brief — DRAFT\n\nQuantity: TBD\nMaterial and grade: TBD\nProcess: TBD with manufacturer\nFinish and colour: TBD\nCritical dimensions and tolerances: TBD\nArtwork and engraving: TBD\nAssembly and adhesives: TBD\nInspection and sample approval: Required\nPackaging and shipping: TBD\n\nOpen questions:\n- Confirm process and supplier capabilities.\n- Review dimensioned engineering drawings.\n- Approve a physical sample before batch production.\n`;
function App() {
  const [identity, setIdentity] = useState<{
      email: string;
      role: string;
    } | null>(null),
    [checked, setChecked] = useState(false),
    [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [selected, setSelected] = useState("");
  const [page, setPage] = useState("projects"),
    [tab, setTab] = useState("model"),
    [source, setSource] = useState(sample),
    [baseRevision, setBaseRevision] = useState(0),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [brief, setBrief] = useState(""),
    [create, setCreate] = useState(false);
  const [documentRevision, setDocumentRevision] = useState("");
  const [document, setDocument] = useState(briefTemplate),
    [skills, setSkills] = useState<Skill[]>([]),
    [toolList, setToolList] = useState<Tool[]>([]),
    [skill, setSkill] = useState<Skill>({
      id: "",
      version: 0,
      title: "",
      description: "",
      content: "",
    });
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  function leaveEditor() {
    return !dirty || window.confirm("Discard unsaved model changes?");
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function loadProjects() {
    setProjects(await call<Project[]>("projects_list"));
  }
  async function reload(projectId: string) {
    const next = await call<Workspace>("projects_get", { projectId });
    setWorkspace(next);
    return next;
  }
  async function signIn() {
    const session = await (await request("/api/session")).json();
    setIdentity(session);
    await loadProjects();
  }
  useEffect(() => {
    void signIn()
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);
  useEffect(() => {
    if (!workspace?.jobs.some((j) => ["queued", "running"].includes(j.status)))
      return;
    const timer = setInterval(() => {
      void reload(workspace.project.id).catch((e) => setError(e.message));
    }, 2500);
    return () => clearInterval(timer);
  }, [workspace]);
  function chooseModel(next: Workspace, modelId: string) {
    const model = next.models.find((m) => m.id === modelId);
    const revision = next.revisions.find(
      (r) => r.model_id === modelId && r.number === model?.revision,
    );
    setSelected(modelId);
    setSource(revision?.source ?? sample);
    setBaseRevision(model?.revision ?? 0);
    setDirty(false);
  }
  const currentRevision = workspace?.revisions.find(
    (r) => r.model_id === selected && r.number === baseRevision,
  );
  const job = workspace?.jobs.find(
    (j) => j.revision_id === currentRevision?.id,
  );
  const artifacts =
    workspace?.artifacts.filter((a) => a.job_id === job?.id) ?? [];
  const preview = artifacts.find((a) => a.name.endsWith(".glb"));
  async function openProject(projectId: string) {
    if (!leaveEditor()) return;
    setDocument(briefTemplate);
    setDocumentRevision("");
    const next = await reload(projectId);
    if (next.models[0]) chooseModel(next, next.models[0].id);
    else {
      setSelected("");
      setSource(sample);
      setBaseRevision(0);
      setDirty(false);
    }
    setPage("workspace");
    setTab("model");
  }
  async function openExtensions() {
    if (!leaveEditor()) return;
    setDirty(false);
    setSkills(await call<Skill[]>("skills_list"));
    setToolList(await (await request("/api/tools")).json());
    setPage("extensions");
  }
  async function save(build: boolean) {
    if (!workspace) return;
    let modelId = selected;
    if (!modelId) {
      const model = await call<{ id: string }>("models_create", {
        projectId: workspace.project.id,
        name: "Model 01",
      });
      modelId = model.id;
      setSelected(modelId);
    }
    let revisionId = currentRevision?.id;
    if (dirty || !revisionId) {
      const saved = await call<{ id: string; number: number }>("models_save", {
        modelId,
        expectedRevision: baseRevision,
        source,
      });
      revisionId = saved.id;
      setBaseRevision(saved.number);
      setDirty(false);
    }
    if (build) await call("models_build", { revisionId });
    await reload(workspace.project.id);
  }
  const header = (
    <header>
      <button
        className="brand"
        onClick={() =>
          void action(async () => {
            if (!leaveEditor()) return;
            setDirty(false);
            await loadProjects();
            setPage("projects");
          })
        }
      >
        <span className="brand-icon">◈</span>
        <span>
          DEAL TOY<span className="brand-sub">DESIGN STUDIO</span>
        </span>
      </button>
      <div className="header-right">
        <span className="pill">UNITED AI</span>
        {identity && (
          <>
            <span className="identity">{identity.email}</span>
            <button
              className="quiet"
              onClick={() => {
                if (!leaveEditor()) return;
                setDirty(false);
                sessionStorage.removeItem(tokenKey);
                setIdentity(null);
                setWorkspace(null);
                setProjects([]);
              }}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </header>
  );
  if (!checked)
    return (
      <>
        {header}
        <main>
          <p>Opening your workspace…</p>
        </main>
      </>
    );
  if (!identity)
    return (
      <>
        {header}
        <main className="signin">
          <span className="eyebrow">A WORKSPACE FOR PHYSICAL IDEAS</span>
          <h1>
            From a brief
            <br />
            to something tangible.
          </h1>
          <p>
            Design, inspect, and prepare custom deal toys with your AI tools.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sessionStorage.setItem(tokenKey, token);
              void action(signIn);
            }}
          >
            <label>
              Personal access token
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </label>
            <button disabled={busy}>Open workspace →</button>
          </form>
          <p className="muted">
            Use your administrator-issued token, or sign in through your
            organization’s protected URL.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </main>
      </>
    );
  return (
    <>
      {header}
      <div className="shell">
        <aside className="nav">
          <span className="eyebrow">WORKSPACE</span>
          <button
            className={page !== "extensions" ? "nav-active" : ""}
            onClick={() =>
              void action(async () => {
                if (!leaveEditor()) return;
                setDirty(false);
                await loadProjects();
                setPage("projects");
              })
            }
          >
            ▦ <span>Projects</span>
          </button>
          <button
            className={page === "extensions" ? "nav-active" : ""}
            onClick={() => void action(openExtensions)}
          >
            ⌘ <span>Skills & tools</span>
          </button>
          <div className="nav-bottom">
            <span className="status-dot" /> build123d + OCCT
            <p>Agent-connected CAD</p>
          </div>
        </aside>
        <main>
          {error && (
            <div role="alert" className="error">
              {error}
              <button className="quiet" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {page === "projects" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR DESIGN LIBRARY</span>
                  <h1>Projects</h1>
                  <p>
                    Every design, revision, and manufacturing detail in one
                    place.
                  </p>
                </div>
                <button disabled={busy} onClick={() => setCreate(!create)}>
                  ＋ New project
                </button>
              </div>
              {create && (
                <form
                  className="panel create-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const p = await call<Project>("projects_create", {
                        name,
                        brief,
                      });
                      setName("");
                      setBrief("");
                      setCreate(false);
                      await loadProjects();
                      await openProject(p.id);
                    });
                  }}
                >
                  <label>
                    Project name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                      placeholder="e.g. Infrastructure acquisition"
                      required
                    />
                  </label>
                  <label>
                    Design brief
                    <textarea
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      placeholder="What does this piece commemorate? Include dimensions, quantity, and constraints you know."
                      maxLength={12000}
                    />
                  </label>
                  <button disabled={busy}>Create project</button>
                </form>
              )}
              <div className="project-grid">
                {projects.map((p, index) => (
                  <button
                    className="project-card"
                    key={p.id}
                    onClick={() => void action(() => openProject(p.id))}
                  >
                    <div className={`project-art art-${index % 3}`}>
                      <span>◇</span>
                      <span className="project-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="card-body">
                      <span className="eyebrow">DESIGN PROJECT</span>
                      <h2>{p.name}</h2>
                      <p>{p.brief || "Ready for your first model."}</p>
                      <div className="card-meta">
                        {new Date(p.created_at).toLocaleDateString()}{" "}
                        <span>Open workspace ↗</span>
                      </div>
                    </div>
                  </button>
                ))}
                {!projects.length && (
                  <div className="empty-library">
                    <span className="large-symbol">▱</span>
                    <h2>A home for your next idea.</h2>
                    <p>
                      Create a project to start modeling and collecting the
                      details your manufacturer needs.
                    </p>
                    <button onClick={() => setCreate(true)}>
                      Create your first project
                    </button>
                  </div>
                )}
              </div>
              <div className="library-note">
                <span>01 / BRIEF</span>
                <span>02 / MODEL & REFINE</span>
                <span>03 / PREPARE FOR MANUFACTURING</span>
              </div>
            </>
          )}
          {page === "workspace" && workspace && (
            <>
              <button
                className="breadcrumb quiet"
                onClick={() => {
                  if (!leaveEditor()) return;
                  setDirty(false);
                  setPage("projects");
                }}
              >
                Projects / <strong>{workspace.project.name}</strong>
              </button>
              <div className="page-heading compact">
                <div>
                  <h1>{workspace.project.name}</h1>
                  <p>
                    {workspace.project.brief ||
                      "Add your model and build from here."}
                  </p>
                </div>
                <span className="pill">DESIGN IN PROGRESS</span>
              </div>
              <div className="tabs">
                <button
                  className={tab === "model" ? "active" : ""}
                  onClick={() => setTab("model")}
                >
                  Model workspace
                </button>
                <button
                  className={tab === "documents" ? "active" : ""}
                  onClick={() => {
                    setDocumentRevision(currentRevision?.id ?? "");
                    setTab("documents");
                  }}
                >
                  Manufacturing documents{" "}
                  <small>{workspace.documents.length}</small>
                </button>
                <button
                  className={tab === "connect" ? "active" : ""}
                  onClick={() => setTab("connect")}
                >
                  Connect an agent
                </button>
              </div>
              {tab === "model" && (
                <>
                  <div className="model-toolbar">
                    <select
                      aria-label="Model"
                      value={selected}
                      onChange={(e) => {
                        if (dirty) {
                          setError(
                            "Save your changes before switching models.",
                          );
                          return;
                        }
                        chooseModel(workspace, e.target.value);
                      }}
                    >
                      <option value="">New model</option>
                      {workspace.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · revision {m.revision}
                        </option>
                      ))}
                    </select>
                    <button
                      className="secondary"
                      disabled={busy || dirty}
                      onClick={() =>
                        void action(async () => {
                          const m = await call<{ id: string }>(
                            "models_create",
                            {
                              projectId: workspace.project.id,
                              name: `Model ${String(workspace.models.length + 1).padStart(2, "0")}`,
                            },
                          );
                          const next = await reload(workspace.project.id);
                          chooseModel(next, m.id);
                        })
                      }
                    >
                      ＋ Add model
                    </button>
                    <span className="spacer" />
                    <span className="muted">
                      {dirty ? "Unsaved changes" : `Revision ${baseRevision}`}
                    </span>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void action(() => save(false))}
                    >
                      Save
                    </button>
                    <button
                      disabled={
                        busy ||
                        job?.status === "queued" ||
                        job?.status === "running"
                      }
                      onClick={() => void action(() => save(true))}
                    >
                      {job?.status === "queued" || job?.status === "running"
                        ? "Building…"
                        : "Build model ↗"}
                    </button>
                  </div>
                  <div className="model-layout">
                    <section className="source-panel">
                      <div className="panel-title">
                        model.py <span>PYTHON</span>
                      </div>
                      <textarea
                        className="code"
                        aria-label="Python model source"
                        spellCheck={false}
                        value={source}
                        onChange={(e) => {
                          setSource(e.target.value);
                          setDirty(true);
                        }}
                      />
                      <div className="code-help">
                        Define <code>build()</code> and return a build123d
                        solid. Units: mm.
                      </div>
                    </section>
                    <Suspense
                      fallback={<div className="viewer">Loading 3D view…</div>}
                    >
                      <Viewer artifactId={preview?.id} />
                    </Suspense>
                  </div>
                  <div className="build-footer">
                    <div>
                      <span className="eyebrow">BUILD STATUS</span>
                      <h3>{job?.status ?? "Not built yet"}</h3>
                      {job?.error && <pre className="error">{job.error}</pre>}
                      {job?.facts && (
                        <p>
                          {JSON.parse(job.facts)
                            .bounds.map((n: number) => n.toFixed(1))
                            .join(" × ")}{" "}
                          mm · {JSON.parse(job.facts).solids} solid(s)
                        </p>
                      )}
                      <p className="muted">
                        {dirty
                          ? "Preview shows the last built revision; save and build to update."
                          : "Exports belong to the selected saved revision."}
                      </p>
                    </div>
                    <div className="exports">
                      {artifacts.map((a: Artifact) => (
                        <button
                          className="secondary"
                          key={a.id}
                          onClick={() =>
                            void action(() => download(a.id, a.name))
                          }
                        >
                          ↓ {a.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {tab === "documents" && (
                <div className="documents-layout">
                  <section className="panel">
                    <span className="eyebrow">MANUFACTURING BRIEF</span>
                    <h2>Make the handoff explicit.</h2>
                    <p>
                      Record materials, finishes, tolerances, assembly and
                      inspection requirements. New entries preserve previous
                      versions.
                    </p>
                    <label>
                      Revision to document
                      <select
                        disabled={!workspace.revisions.length}
                        value={documentRevision}
                        onChange={(e) => setDocumentRevision(e.target.value)}
                      >
                        <option value="">Project-wide</option>
                        {workspace.revisions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {
                              workspace.models.find((m) => m.id === r.model_id)
                                ?.name
                            }{" "}
                            / rev {r.number}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Brief
                      <textarea
                        className="document-editor"
                        value={document}
                        onChange={(e) => setDocument(e.target.value)}
                        maxLength={30000}
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await call("documents_add", {
                            projectId: workspace.project.id,
                            revisionId: documentRevision || undefined,
                            kind: "manufacturing-brief",
                            title: "Manufacturing brief",
                            content: document,
                          });
                          await reload(workspace.project.id);
                        })
                      }
                    >
                      Save draft brief
                    </button>
                  </section>
                  <section>
                    <div className="notice">
                      <strong>Design review required</strong>
                      <p>
                        Geometry validation does not establish
                        manufacturability. Dimensioned drawings,
                        process-specific DFM, supplier confirmation, and sample
                        approval remain review steps.
                      </p>
                    </div>
                    {workspace.documents.map((d) => (
                      <article className="panel document-card" key={d.id}>
                        <span className="pill">
                          DRAFT · VERSION {d.version}
                        </span>
                        <h3>{d.title}</h3>
                        <p className="muted">
                          {d.model_revision_id
                            ? `Model revision ${workspace.revisions.find((r) => r.id === d.model_revision_id)?.number}`
                            : "Project-wide document"}
                        </p>
                        <pre>{d.content}</pre>
                        <button
                          className="secondary"
                          onClick={() => {
                            setDocument(d.content);
                            setDocumentRevision(d.model_revision_id ?? "");
                          }}
                        >
                          Use as next draft
                        </button>
                        <button
                          className="quiet"
                          onClick={() =>
                            saveBlob(
                              new Blob([d.content], {
                                type: "text/markdown;charset=utf-8",
                              }),
                              `${d.kind}-v${d.version}.md`,
                            )
                          }
                        >
                          Download draft
                        </button>
                      </article>
                    ))}
                  </section>
                </div>
              )}
              {tab === "connect" && (
                <section className="panel connect">
                  <span className="eyebrow">BRING YOUR AI</span>
                  <h2>One workspace. Your choice of agent.</h2>
                  <p>
                    Connect an MCP client that supports Streamable HTTP and
                    bearer authentication.
                  </p>
                  <label>
                    Server endpoint
                    <input readOnly value={`${location.origin}/mcp`} />
                  </label>
                  <p>
                    Use an administrator-issued personal token as the
                    Authorization bearer token. Keep it in your client’s secret
                    store.
                  </p>
                  <pre>{`1. projects_list → choose this project\n2. models_create → models_save\n3. models_build → builds_get\n4. documents_add → revision-linked manufacturing notes`}</pre>
                  <p className="muted">
                    Browser-based clients that require OAuth need the planned
                    OAuth adapter. A chat subscription alone does not guarantee
                    MCP support.
                  </p>
                </section>
              )}
            </>
          )}
          {page === "extensions" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">EXTEND YOUR WORKSPACE</span>
                  <h1>Skills & tools</h1>
                  <p>
                    Workflow guidance and typed actions, managed independently.
                  </p>
                </div>
              </div>
              <div className="extensions-layout">
                <section>
                  <h2>Workflow skills</h2>
                  {skills.map((s) => (
                    <button
                      key={s.id}
                      className="skill-card"
                      onClick={() => setSkill(s)}
                    >
                      <strong>{s.title}</strong>
                      <span>v{s.version}</span>
                      <p>{s.description}</p>
                    </button>
                  ))}
                  {identity.role === "admin" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        setSkill({
                          id: "",
                          version: 0,
                          title: "",
                          description: "",
                          content: "",
                        })
                      }
                    >
                      ＋ New skill
                    </button>
                  )}
                  <h2 className="section-gap">Registered tools</h2>
                  {toolList.map((t) => (
                    <div className="tool-row" key={t.name}>
                      <div>
                        <strong>{t.name}</strong>
                        <p>{t.description}</p>
                      </div>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={t.enabled}
                          disabled={
                            identity.role !== "admin" ||
                            t.name === "tools_configure" ||
                            busy
                          }
                          onChange={(e) =>
                            void action(async () => {
                              await call("tools_configure", {
                                name: t.name,
                                enabled: e.target.checked,
                              });
                              await openExtensions();
                            })
                          }
                        />
                        Enabled
                      </label>
                    </div>
                  ))}
                  <p className="muted">
                    Add executable tools through the repository’s typed registry
                    and PR checks.
                  </p>
                </section>
                <form
                  className="panel skill-editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await call("skills_save", {
                        skillId: skill.id,
                        expectedVersion: skill.version,
                        title: skill.title,
                        description: skill.description,
                        content: skill.content,
                      });
                      const next = await call<Skill[]>("skills_list");
                      setSkills(next);
                      setSkill(next.find((s) => s.id === skill.id)!);
                    });
                  }}
                >
                  <span className="eyebrow">SKILL EDITOR</span>
                  <h2>{skill.title || "New workflow skill"}</h2>
                  <label>
                    Identifier
                    <input
                      required
                      pattern="[a-z][a-z0-9-]{1,59}"
                      value={skill.id}
                      disabled={skill.version > 0 || identity.role !== "admin"}
                      onChange={(e) =>
                        setSkill({ ...skill, id: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Title
                    <input
                      required
                      value={skill.title}
                      onChange={(e) =>
                        setSkill({ ...skill, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Description
                    <input
                      required
                      value={skill.description}
                      onChange={(e) =>
                        setSkill({ ...skill, description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Markdown instructions
                    <textarea
                      required
                      value={skill.content}
                      onChange={(e) =>
                        setSkill({ ...skill, content: e.target.value })
                      }
                    />
                  </label>
                  {identity.role === "admin" && (
                    <button disabled={busy}>
                      Publish version {skill.version + 1}
                    </button>
                  )}
                  <p className="muted">
                    Skills provide guidance. They cannot change access or
                    execute new server code.
                  </p>
                </form>
              </div>
            </>
          )}
          <footer>
            DEAL TOY STUDIO{" "}
            <span>Built for the details that make it real.</span>
          </footer>
        </main>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
