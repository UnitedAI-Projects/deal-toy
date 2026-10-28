import { z } from "zod";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const id = z.string().uuid();
export const shortText = z.string().trim().min(1).max(120);
export type Identity = { email: string; role: "admin" | "maker" };
export type Context = { env: Env; identity: Identity };
export async function hash(value: string | Uint8Array): Promise<string> {
  const data =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function projectAccess(c: Context, projectId: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM projects WHERE id=? AND owner=?",
  )
    .bind(projectId, c.identity.email)
    .first();
  if (!row) throw new AppError(404, "Project not found");
  return row;
}
export async function modelAccess(c: Context, modelId: string) {
  const row = await c.env.DB.prepare(
    "SELECT models.* FROM models JOIN projects ON projects.id=models.project_id WHERE models.id=? AND projects.owner=?",
  )
    .bind(modelId, c.identity.email)
    .first<{
      id: string;
      project_id: string;
      name: string;
      revision: number;
    }>();
  if (!row) throw new AppError(404, "Model not found");
  return row;
}
export async function revisionAccess(c: Context, revisionId: string) {
  const row = await c.env.DB.prepare(
    "SELECT revisions.*, models.project_id FROM revisions JOIN models ON models.id=revisions.model_id JOIN projects ON projects.id=models.project_id WHERE revisions.id=? AND projects.owner=?",
  )
    .bind(revisionId, c.identity.email)
    .first<{
      id: string;
      source: string;
      number: number;
      project_id: string;
    }>();
  if (!row) throw new AppError(404, "Revision not found");
  return row;
}
export function admin(c: Context) {
  if (c.identity.role !== "admin")
    throw new AppError(403, "Administrator access required");
}
export async function boundedText(
  request: Request,
  limit = 150_000,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, "Request too large");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(output);
}
