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
