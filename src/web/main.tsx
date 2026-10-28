import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  call,
  can,
  request,
  send,
  type Me,
  type Project,
  type ProjectList,
  type Skill,
  type Tool,
  type Workspace as WorkspaceData,
} from "./api";
import { SignIn } from "./SignIn";
import { useTheme, type ThemeChoice } from "./theme";
import { Workspace } from "./Workspace";
import "./style.css";
function App() {
  const { theme, choice, choose } = useTheme();
  const [identity, setIdentity] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [page, setPage] = useState<"projects" | "workspace" | "extensions">(
    "projects",
  );
  const [projects, setProjects] = useState<ProjectList>({ own: [], demo: [] });
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  async function loadProjects() {
    setProjects(await call<ProjectList>("projects_list"));
  }
  async function signIn() {
    setIdentity(await (await request("/api/session")).json());
    await loadProjects();
  }
  useEffect(() => {
    void signIn()
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);
  async function openProject(projectId: string) {
    setWorkspace(await call<WorkspaceData>("projects_get", { projectId }));
    setPage("workspace");
  }
  function signOut() {
    void send("/api/auth/signout", "POST", {})
      .catch(() => {})
      .finally(() => {
        setIdentity(null);
        setWorkspace(null);
        setProjects({ own: [], demo: [] });
        setPage("projects");
      });
  }
  if (!checked) return <div className="splash">Opening Mantel…</div>;
  if (!identity) return <SignIn theme={theme} onSignedIn={signIn} />;
  if (page === "workspace" && workspace)
    return (
      <Workspace
        key={workspace.project.id}
        data={workspace}
        reload={async () => {
          const next = await call<WorkspaceData>("projects_get", {
            projectId: workspace.project.id,
          });
          setWorkspace(next);
          return next;
        }}
        me={identity}
        theme={theme}
        themeChoice={choice}
        chooseTheme={choose}
        onBack={() => {
          setPage("projects");
          void loadProjects().catch((e: Error) => setError(e.message));
        }}
        onExtensions={() => setPage("extensions")}
        onSignOut={signOut}
      />
    );
  return (
    <div className="page">
      <PageHeader
        identity={identity}
        choice={choice}
        choose={choose}
        page={page}
        go={(next) => {
          setPage(next);
          if (next === "projects")
            void loadProjects().catch((e: Error) => setError(e.message));
        }}
        onSignOut={signOut}
      />
      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="link" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      {page === "extensions" ? (
        <Extensions identity={identity} />
      ) : (
        <Library
          projects={projects}
          canCreate={can(identity, "projects.create")}
          onOpen={(id) =>
            void openProject(id).catch((e: Error) => setError(e.message))
          }
          onCreated={async (id) => {
            await loadProjects();
            await openProject(id);
          }}
        />
      )}
    </div>
  );
}

function PageHeader(props: {
  identity: Me;
  choice: ThemeChoice;
  choose: (c: ThemeChoice) => void;
  page: string;
  go: (page: "projects" | "extensions") => void;
  onSignOut: () => void;
}) {
  return (
    <header className="page-header">
      <button className="brand-link" onClick={() => props.go("projects")}>
        <span className="mark" aria-hidden="true" />
        Mantel
      </button>
      <nav>
        <button
          className={props.page === "projects" ? "on" : ""}
          onClick={() => props.go("projects")}
        >
          Projects
        </button>
        <button
          className={props.page === "extensions" ? "on" : ""}
          onClick={() => props.go("extensions")}
        >
          Skills and tools
        </button>
      </nav>
      <div className="page-header-right">
        <div className="segmented" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as const).map((c) => (
            <button
              key={c}
              className={props.choice === c ? "on" : ""}
              aria-pressed={props.choice === c}
              onClick={() => props.choose(c)}
            >
              {c === "system" ? "Auto" : c === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <span className="muted small">{props.identity.email}</span>
        <button className="ghost" onClick={props.onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}

function ProjectCard(props: {
  project: Project;
  onOpen: (id: string) => void;
}) {
  const p = props.project;
  return (
    <button className="project" onClick={() => props.onOpen(p.id)}>
      <span className="project-art" aria-hidden="true">
        <span className="mark" />
      </span>
      <strong>{p.name}</strong>
      <span className="muted clamp">
        {p.brief || "Ready for its first model."}
      </span>
      <span className="muted small">
        {p.demo ? "Demo · " : ""}
        {new Date(p.created_at).toLocaleDateString()}
      </span>
    </button>
  );
}

function Library(props: {
  projects: ProjectList;
  canCreate: boolean;
  onOpen: (id: string) => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="library">
      <div className="library-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">
            Every design, its agent sessions and revisions.
          </p>
        </div>
        {props.canCreate && (
          <button onClick={() => setCreate(!create)}>New project</button>
        )}
      </div>
      {create && (
        <form
          className="card create"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            call<Project>("projects_create", { name, brief })
              .then((p) => props.onCreated(p.id))
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Project name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Infrastructure acquisition"
              required
            />
          </label>
          <label>
            Design brief
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What the piece commemorates, its size, quantity and any constraints you know."
              maxLength={12000}
            />
          </label>
          <div className="row">
            <button disabled={busy}>Create project</button>
            <button
              type="button"
              className="ghost"
              onClick={() => setCreate(false)}
            >
              Cancel
            </button>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </form>
      )}
      <div className="grid">
        {props.projects.own.map((p) => (
          <ProjectCard key={p.id} project={p} onOpen={props.onOpen} />
        ))}
      </div>
      {!props.projects.own.length && !create && props.canCreate && (
        <div className="empty">
          <h2>Start your first project</h2>
          <p className="muted">
            Create a project, then point your agent at it. Its prompt and every
            step show up live next to the model.
          </p>
          <button onClick={() => setCreate(true)}>Create project</button>
        </div>
      )}
      {!props.canCreate && (
        <div className="empty">
          <h2>You're viewing the demo</h2>
          <p className="muted">
            Explore how an agent built it. Ask an admin for access to build your
            own.
          </p>
        </div>
      )}
      {props.projects.demo.length > 0 && (
        <>
          <h2 className="section-title">Demo</h2>
          <div className="grid">
            {props.projects.demo.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={props.onOpen} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

const blankSkill: Skill = {
  id: "",
  version: 0,
  title: "",
  description: "",
  content: "",
};
function Extensions({ identity }: { identity: Me }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [skill, setSkill] = useState<Skill>(blankSkill);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = can(identity, "settings.manage");
  async function load() {
    setSkills(await call<Skill[]>("skills_list"));
    setTools(await (await request("/api/tools")).json());
  }
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, []);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    fn()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <main className="extensions">
      <div className="library-head">
        <div>
          <h1>Skills and tools</h1>
          <p className="muted">
            Workflow guidance and typed actions, managed separately.
          </p>
        </div>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="split">
        <section>
          <h2>Workflow skills</h2>
          {skills.map((s) => (
            <button
              key={s.id}
              className={`list-row ${skill.id === s.id ? "on" : ""}`}
              onClick={() => setSkill(s)}
            >
              <strong>{s.title}</strong>
              <span className="tag">v{s.version}</span>
              <span className="muted small">{s.description}</span>
            </button>
          ))}
          {admin && (
            <button className="secondary" onClick={() => setSkill(blankSkill)}>
              New skill
            </button>
          )}
          <h2>Registered tools</h2>
          {tools.map((t) => (
            <div className="list-row static" key={t.name}>
              <code>{t.name}</code>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  disabled={!admin || t.name === "tools_configure" || busy}
                  onChange={(e) =>
                    run(async () => {
                      await call("tools_configure", {
                        name: t.name,
                        enabled: e.target.checked,
                      });
                      await load();
                    })
                  }
                />
                Enabled
              </label>
              <span className="muted small">{t.description}</span>
            </div>
          ))}
          <p className="muted small">
            New executable tools go through the repository's typed registry and
            PR checks.
          </p>
        </section>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await call("skills_save", {
                skillId: skill.id,
                expectedVersion: skill.version,
                title: skill.title,
                description: skill.description,
                content: skill.content,
              });
              const next = await call<Skill[]>("skills_list");
              setSkills(next);
              setSkill(next.find((s) => s.id === skill.id) ?? blankSkill);
            });
          }}
        >
          <h2>{skill.title || "New workflow skill"}</h2>
          <label>
            Identifier
            <input
              required
              pattern="[a-z][a-z0-9-]{1,59}"
              value={skill.id}
              disabled={skill.version > 0 || !admin}
              onChange={(e) => setSkill({ ...skill, id: e.target.value })}
            />
          </label>
          <label>
            Title
            <input
              required
              value={skill.title}
              disabled={!admin}
              onChange={(e) => setSkill({ ...skill, title: e.target.value })}
            />
          </label>
          <label>
            Description
            <input
              required
              value={skill.description}
              disabled={!admin}
              onChange={(e) =>
                setSkill({ ...skill, description: e.target.value })
              }
            />
          </label>
          <label>
            Markdown instructions
            <textarea
              className="code editor"
              required
              value={skill.content}
              disabled={!admin}
              onChange={(e) => setSkill({ ...skill, content: e.target.value })}
            />
          </label>
          {admin && (
            <button disabled={busy}>Publish version {skill.version + 1}</button>
          )}
          <p className="muted small">
            Skills guide agents. They cannot change access or run new server
            code.
          </p>
        </form>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
