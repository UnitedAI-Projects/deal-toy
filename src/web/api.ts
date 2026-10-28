export const tokenKey = "deal-toy-token";
export async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = sessionStorage.getItem(tokenKey);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(error.error);
  }
  return response;
}
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
  name: string;
  brief: string;
  created_at: string;
};
export type Model = { id: string; name: string; revision: number };
export type Revision = {
  id: string;
  model_id: string;
  number: number;
  source: string;
};
export type Job = {
  id: string;
  revision_id: string;
  status: string;
  facts: string | null;
  error: string | null;
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
export type Facts = {
  bounds: number[];
  volume_mm3: number;
  solids: number;
  params?: Record<string, ParamSpec>;
  parts?: { label: string; volume_mm3: number }[];
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
    | "ended";
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
};
export type Activity = { sessions: Session[]; events: ProjectEvent[] };
export type LiveMessage =
  { type: "event"; event: ProjectEvent } | { type: "workspace" };
/**
 * Follows a project's live activity. A socket cannot carry the bearer token, so each attempt
 * first asks the authenticated API for a single-use ticket. Reconnects with backoff.
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
