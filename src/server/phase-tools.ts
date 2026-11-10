/* A project's phases on the server: the versioned phase state and the files its phases hold. People
   and agents read and write the same state; approvals are recorded only for people. */
import { z } from "zod";
import { AppError, id, projectAccess, type Context } from "./core";
import { notify } from "./activity";
import {
  changedApprovals,
  checkShape,
  removedApprovals,
  stamp,
  withoutPeople,
} from "./phase-rules";
import { define, now, type Tool } from "./tool-kit";

/** Well under D1's row limit. Images and other files go to phase files, not into the state. */
export const MAX_STATE_BYTES = 120_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PHASES = [
  "brief",
  "art",
  "concepts",
  "model",
  "documents",
  "manufacture",
] as const;

type Row = {
  state: string;
  version: number;
  updated_by: string;
  updated_at: string;
};

async function current(c: Context, projectId: string) {
  return await c.env.DB.prepare(
    "SELECT state,version,updated_by,updated_at FROM phase_states WHERE project_id=?",
  )
    .bind(projectId)
    .first<Row>();
}

export const phaseTools: Tool[] = [
  define(
    "phases_get",
    "Read a project's phase state: the brief and its versions, concepts and the chosen concept, the model marked ready, document approvals, the release and suppliers. version is 0 when nothing has been saved yet.",
    { projectId: id },
    true,
    async (c, i) => {
      const project = await projectAccess(c, i.projectId, "read");
      const row = await current(c, i.projectId);
      if (!row) return { state: null, version: 0, updatedAt: null };
      const state = JSON.parse(row.state) as unknown;
      const owns = project.owner === c.identity.email;
      return {
        state: owns ? state : withoutPeople(state),
        version: row.version,
        updatedAt: row.updated_at,
        updatedBy: owns ? row.updated_by : "",
      };
    },
  ),
  define(
    "phases_save",
    "Save a project's whole phase state, replacing version expectedVersion (0 for the first save). Agents may change anything except approvals: adding, changing or removing an approval (a brief, a chosen concept, a model marked ready, a document, a release, an order) is refused, because only people approve.",
    {
      projectId: id,
      expectedVersion: z.number().int().min(0),
      state: z.record(z.string(), z.unknown()),
    },
    false,
    async (c, i) => {
      await projectAccess(c, i.projectId);
      checkShape(i.state);
      const text = JSON.stringify(i.state);
      if (text.length > MAX_STATE_BYTES)
        throw new AppError(
          413,
          `Phase state is ${text.length} bytes; the limit is ${MAX_STATE_BYTES}. Store images and documents as phase files.`,
        );
      const row = await current(c, i.projectId);
      const version = row?.version ?? 0;
      if (version !== i.expectedVersion)
        throw new AppError(
          409,
          `The phases changed since version ${i.expectedVersion}; the current version is ${version}. Read them again and reapply your change.`,
        );
      const before = row ? (JSON.parse(row.state) as unknown) : {};
      const changed = changedApprovals(before, i.state);
      const removed = removedApprovals(before, i.state);
      if (c.channel === "mcp" && (changed.length || removed.length))
        throw new AppError(
          403,
          `Only people approve. This save would change: ${[...changed, ...removed].join(", ")}. Leave approvals as they are and ask the person to approve in Mantel.`,
        );
      const at = now();
      const state = stamp(i.state, changed, { by: c.identity.email, at });
      const next = version + 1;
      const result = await c.env.DB.prepare(
        `INSERT INTO phase_states (project_id,state,version,updated_by,updated_at) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(project_id) DO UPDATE SET state=excluded.state, version=excluded.version,
           updated_by=excluded.updated_by, updated_at=excluded.updated_at
         WHERE phase_states.version=?6`,
      )
        .bind(
          i.projectId,
          JSON.stringify(state),
          next,
          c.identity.email,
          at,
          version,
        )
        .run();
      if (!result.meta.changes)
        throw new AppError(
          409,
          "The phases changed while saving; read them again",
        );
      await notify(c.env, i.projectId, { type: "phases", version: next });
      return { version: next, updatedAt: at, state };
    },
  ),
  define(
    "phase_files_list",
    "List the files a project's phases hold (logos, sketches, references, engine saves), newest first. Download one at /api/phase-files/<id>.",
    { projectId: id, phase: z.enum(PHASES).optional() },
    true,
    async (c, i) => {
      const project = await projectAccess(c, i.projectId, "read");
      const owns = project.owner === c.identity.email;
      const { results } = await c.env.DB.prepare(
        `SELECT id,phase,name,media_type,size,sha256,created_by,created_at FROM phase_files
         WHERE project_id=?1 AND (?2 IS NULL OR phase=?2) ORDER BY created_at DESC LIMIT 500`,
      )
        .bind(i.projectId, i.phase ?? null)
        .all<Record<string, unknown>>();
      return {
        files: results.map((r) => ({
          ...r,
          created_by: owns ? r.created_by : "",
          url: `/api/phase-files/${String(r.id)}`,
        })),
      };
    },
  ),
];

/** Reads a request body, stopping as soon as it passes the limit. */
async function boundedBytes(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, "Files are limited to 25 MB");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Stores one uploaded file for a phase. The caller has checked the request's origin. */
export async function addPhaseFile(
  c: Context,
  projectId: string,
  request: Request,
) {
  await projectAccess(c, projectId);
  const url = new URL(request.url);
  const phase = z.enum(PHASES).parse(url.searchParams.get("phase"));
  const name = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^/\\\0]+$/, "A file name, not a path")
    .parse(url.searchParams.get("name"));
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_FILE_BYTES)
    throw new AppError(413, "Files are limited to 25 MB");
  const bytes = await boundedBytes(request, MAX_FILE_BYTES);
  if (!bytes.byteLength) throw new AppError(400, "The file is empty");
  const mediaType =
    (request.headers.get("Content-Type") ?? "").split(";")[0].trim() ||
    "application/octet-stream";
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const fileId = crypto.randomUUID();
  const objectKey = `phases/${projectId}/${fileId}`;
  await c.env.ARTIFACTS.put(objectKey, bytes, {
    httpMetadata: { contentType: mediaType },
  });
  const at = now();
  await c.env.DB.prepare(
    "INSERT INTO phase_files (id,project_id,phase,name,media_type,size,sha256,object_key,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      fileId,
      projectId,
      phase,
      name,
      mediaType,
      bytes.byteLength,
      sha256,
      objectKey,
      c.identity.email,
      at,
    )
    .run();
  return {
    id: fileId,
    phase,
    name,
    media_type: mediaType,
    size: bytes.byteLength,
    sha256,
    created_at: at,
    url: `/api/phase-files/${fileId}`,
  };
}

/**
 * Serves a phase file to anyone who may read its project. Uploaded content is untrusted: it is
 * sandboxed so an SVG or HTML file opened directly can't run script on Mantel's origin.
 */
export async function getPhaseFile(c: Context, fileId: string) {
  const file = await c.env.DB.prepare(
    "SELECT project_id,name,media_type,object_key FROM phase_files WHERE id=?",
  )
    .bind(fileId)
    .first<{
      project_id: string;
      name: string;
      media_type: string;
      object_key: string;
    }>();
  if (!file) throw new AppError(404, "File not found");
  await projectAccess(c, file.project_id, "read");
  const object = await c.env.ARTIFACTS.get(file.object_key);
  if (!object) throw new AppError(404, "File missing");
  const image = /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.media_type);
  return new Response(object.body, {
    headers: {
      "Content-Type": file.media_type,
      "Content-Disposition": `${image ? "inline" : "attachment"}; filename="${file.name.replace(/["\r\n]/g, "_")}"`,
      "Content-Security-Policy":
        "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
