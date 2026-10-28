import { z } from "zod";
import { requirePermission } from "./access";
import { secret } from "./auth";
import { AppError, boundedText, hash, type Context } from "./core";
import {
  account,
  createLevel,
  deleteLevel,
  levelCreate,
  levelUpdate,
  listLevels,
  listMembers,
  memberUpdate,
  renameAccount,
  setDemo,
  updateLevel,
  updateMember,
} from "./members";

const MAX_KEYS = 10;
const keyInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    days: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90),
  })
  .strict();

const accountInput = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
const demoInput = z.object({ demo: z.boolean() }).strict();

async function json(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new AppError(415, "Use application/json");
  try {
    return JSON.parse(await boundedText(request, 20_000)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Invalid JSON");
  }
}
const now = () => new Date().toISOString();

/** Handles /api/settings/* for the signed-in member, or returns null for other paths. */
export async function settingsRoute(
  request: Request,
  url: URL,
  c: Context,
): Promise<Response | null> {
  const path = url.pathname.slice("/api/settings".length);
  const method = request.method;
  if (path === "/keys" && method === "GET")
    return Response.json(await listKeys(c));
  if (path === "/keys" && method === "POST")
    return Response.json(
      await createKey(c, keyInput.parse(await json(request))),
    );
  const keyMatch = /^\/keys\/([0-9a-f-]{36})$/.exec(path);
  if (keyMatch && method === "DELETE") {
    await revokeKey(c, keyMatch[1]);
    return Response.json({ ok: true });
  }
  if (path === "/account" && method === "GET")
    return Response.json(await account(c));
  if (path === "/account" && method === "PATCH")
    return Response.json(
      await renameAccount(c, accountInput.parse(await json(request)).name),
    );
  if (path === "/members" && method === "GET")
    return Response.json(await listMembers(c));
  const memberMatch = /^\/members\/([^/]{3,320})$/.exec(path);
  if (memberMatch && method === "PATCH")
    return Response.json(
      await updateMember(
        c,
        decodeURIComponent(memberMatch[1]).toLowerCase(),
        memberUpdate.parse(await json(request)),
      ),
    );
  if (path === "/levels" && method === "GET")
    return Response.json(await listLevels(c));
  if (path === "/levels" && method === "POST")
    return Response.json(
      await createLevel(c, levelCreate.parse(await json(request))),
    );
  const levelMatch = /^\/levels\/(level-[a-z0-9-]{1,40})$/.exec(path);
  if (levelMatch && method === "PATCH")
    return Response.json(
      await updateLevel(
        c,
        levelMatch[1],
        levelUpdate.parse(await json(request)),
      ),
    );
  if (levelMatch && method === "DELETE")
    return Response.json(await deleteLevel(c, levelMatch[1]));
  const demoMatch = /^\/projects\/([0-9a-f-]{36})\/demo$/.exec(path);
  if (demoMatch && method === "PATCH")
    return Response.json(
      await setDemo(c, demoMatch[1], demoInput.parse(await json(request)).demo),
    );
  return null;
}

async function listKeys(c: Context) {
  return (
    await c.env.DB.prepare(
      "SELECT id,name,prefix,created_at,expires_at,last_used_at FROM api_keys WHERE email=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC",
    )
      .bind(c.identity.email, now())
      .all()
  ).results;
}

/** Creates a key and returns it once; only its hash and an 8-character prefix are stored. */
async function createKey(c: Context, input: z.infer<typeof keyInput>) {
  requirePermission(c, "keys.use");
  const key = `mtl_${secret()}`;
  const row = {
    id: crypto.randomUUID(),
    name: input.name,
    expires_at: new Date(Date.now() + input.days * 86400_000).toISOString(),
  };
  const inserted = await c.env.DB.prepare(
    `INSERT INTO api_keys (id,email,name,prefix,hash,created_at,expires_at)
     SELECT ?1,?2,?3,?4,?5,?6,?7
     WHERE (SELECT count(*) FROM api_keys WHERE email=?2 AND revoked_at IS NULL AND expires_at>?6)<${MAX_KEYS}`,
  )
    .bind(
      row.id,
      c.identity.email,
      row.name,
      key.slice(0, 8),
      await hash(key),
      now(),
      row.expires_at,
    )
    .run();
  if (inserted.meta.changes !== 1)
    throw new AppError(
      409,
      `You have ${MAX_KEYS} active keys; revoke one first`,
    );
  return { ...row, key };
}

async function revokeKey(c: Context, id: string) {
  const result = await c.env.DB.prepare(
    "UPDATE api_keys SET revoked_at=? WHERE id=? AND email=? AND revoked_at IS NULL",
  )
    .bind(now(), id, c.identity.email)
    .run();
  if (result.meta.changes !== 1) throw new AppError(404, "Key not found");
}
