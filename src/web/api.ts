/** A failed API request, with its HTTP status (409 means someone else saved first). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** Calls the app's API with the browser's session cookie. */
export async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: `Request failed (${response.status})` }));
    throw new ApiError(error.error, response.status);
  }
  return response;
}
export type PhaseFile = {
  id: string;
  phase: string;
  name: string;
  media_type: string;
  size: number;
  url: string;
};
/** Stores a file in one of a project's phases (logos, sketches, references, engine saves). */
export async function uploadPhaseFile(
  projectId: string,
  phase: string,
  name: string,
  body: Blob,
): Promise<PhaseFile> {
  const q = new URLSearchParams({ phase, name });
  return (
    await request(`/api/projects/${projectId}/phase-files?${q}`, {
      method: "POST",
      headers: { "Content-Type": body.type || "application/octet-stream" },
      body,
    })
  ).json();
}
export async function send<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  return (
    await request(path, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json();
}
export const PERMISSIONS = [
  ["demo.view", "View the demo", "Open the demo project and its build"],
  ["projects.create", "Create projects", "Start their own projects"],
  ["models.edit", "Edit models", "Change source and dimensions"],
  ["builds.run", "Run builds", "Queue CAD builds (uses compute)"],
  [
    "exports.download",
    "Download exports",
    "STEP, STL, blueprints and source code",
  ],
  ["notes.write", "Leave notes", "Send notes to agents"],
  ["members.manage", "Manage members", "Change levels and suspend people"],
  [
    "settings.manage",
    "Configure skills and tools",
    "Skills, tools and the demo project",
  ],
] as const;
export type Permission = (typeof PERMISSIONS)[number][0];
/** The signed-in person and their current access. */
export type Me = {
  email: string;
  name: string;
  owner: boolean;
  permissions: Permission[];
};
export const can = (me: Me, permission: Permission) =>
  me.owner || me.permissions.includes(permission);
export async function call<T>(name: string, input: unknown = {}): Promise<T> {
  return (
    await request(`/api/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  ).json();
}
export async function download(id: string, name: string) {
  const blob = await (await request(`/api/artifacts/${id}`)).blob();
  saveBlob(blob, name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export type Project = {
  id: string;
  owner: string;
  name: string;
  brief: string;
  demo: number;
  created_at: string;
};
export type ProjectList = { own: Project[]; demo: Project[] };
export type TrashedProject = Project & {
  deleted_at: string;
  deleted_by: string;
  purge_after: string;
};
export type Model = { id: string; name: string; revision: number };
export type Revision = {
  id: string;
  model_id: string;
  number: number;
  created_at: string;
  /** Absent on someone else's project unless you may download exports. */
  source?: string;
};
export type Job = {
  id: string;
  revision_id: string;
  status: string;
  facts: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};
export type Artifact = {
  id: string;
  job_id: string;
  name: string;
  size: number;
};
export type Document = {
  id: string;
  title: string;
  kind: string;
  content: string;
  model_revision_id: string | null;
  version: number;
};
export type Workspace = {
  project: Project;
  models: Model[];
  revisions: Revision[];
  jobs: Job[];
  artifacts: Artifact[];
  documents: Document[];
};
export type Skill = {
  id: string;
  version: number;
  title: string;
  description: string;
  content: string;
};
export type Tool = {
  name: string;
  description: string;
  readOnly: boolean;
  enabled: boolean;
};
export type ParamSpec = {
  value: number;
  unit?: string;
  part?: string;
  min?: number;
  max?: number;
};
/** One step's result in a build, as the engine reports it. */
export type StepLog = {
  name: string;
  action: string;
  version: number;
  state: "ok" | "warning" | "failed" | "blocked" | "suppressed";
  code?: string;
  message?: string;
  created: string[];
  ms: number;
};
export type Facts = {
  bounds: number[];
  volume_mm3: number;
  solids: number;
  params?: Record<string, ParamSpec>;
  parts?: { label: string; volume_mm3: number }[];
  steps?: StepLog[];
  incomplete?: boolean;
};
export type Session = {
  id: string;
  project_id: string;
  member: string;
  client: string | null;
  prompt: string;
  title: string | null;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
  last_event_at: string;
  active: boolean;
};
export type ProjectEvent = {
  id: string;
  session_id: string | null;
  kind:
    | "prompt"
    | "agent_update"
    | "tool_call"
    | "team_note"
    | "team_edit"
    | "ended"
    | "design"
    | "change";
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
};
export type Activity = { sessions: Session[]; events: ProjectEvent[] };
export type LiveMessage =
  | { type: "event"; event: ProjectEvent }
  | { type: "workspace" }
  /** Someone saved the project's phases. */
  | { type: "phases"; version: number }
  /** The agent points at faces or parts of a build in every watching viewer. */
  | {
      type: "highlight";
      jobId: string;
      faces: number[];
      parts: string[];
      message: string;
    };
/**
 * Follows a project's live activity. Each attempt first asks the signed-in API for a
 * single-use ticket that the socket presents. Reconnects with backoff.
 */
export function connectLive(
  projectId: string,
  onMessage: (message: LiveMessage) => void,
  onStatus: (connected: boolean) => void,
) {
  let socket: WebSocket | undefined;
  let closed = false;
  let delay = 1000;
  let ping: ReturnType<typeof setInterval> | undefined;
  const retry = () => {
    if (closed) return;
    setTimeout(open, delay);
    delay = Math.min(delay * 2, 30_000);
  };
  async function open() {
    try {
      const { ticket } = (await (
        await request(`/api/projects/${projectId}/live-ticket`, {
          method: "POST",
        })
      ).json()) as { ticket: string };
      if (closed) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${scheme}//${location.host}/api/projects/${projectId}/live?ticket=${encodeURIComponent(ticket)}`,
      );
      socket.onopen = () => {
        delay = 1000;
        onStatus(true);
        ping = setInterval(() => socket?.send("ping"), 30_000);
      };
      socket.onmessage = (message) => {
        if (message.data === "pong") return;
        try {
          onMessage(JSON.parse(String(message.data)) as LiveMessage);
        } catch {
          // Ignore malformed frames.
        }
      };
      socket.onclose = () => {
        clearInterval(ping);
        onStatus(false);
        retry();
      };
    } catch {
      onStatus(false);
      retry();
    }
  }
  void open();
  return () => {
    closed = true;
    clearInterval(ping);
    socket?.close();
  };
}
