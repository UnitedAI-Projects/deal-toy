import { loadIdentity } from "./access";
import { AppError, hash, type Identity } from "./core";

export const SESSION_COOKIE = "__Host-mantel_session";
const SESSION_MS = 30 * 86400_000;
const LINK_MS = 15 * 60_000;
const SLIDE_MS = 3600_000;
const ACTIVE_MS = 5 * 60_000;
type Db = Pick<Env, "DB">;

/** A random secret of 32 bytes, base64url without padding (43 characters). */
export function secret(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("Cookie") ?? "").split(/;\s*/)) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index) === name)
      return part.slice(index + 1);
  }
  return undefined;
}
export function cookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

/** Starts a browser session and returns its Set-Cookie header. Only the hash is stored. */
export async function createSession(env: Db, email: string, userAgent: string) {
  const token = secret();
  const now = new Date();
  await env.DB.prepare(
    "INSERT INTO auth_sessions (hash,email,created_at,expires_at,last_seen_at,user_agent) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      await hash(token),
      email,
      now.toISOString(),
      new Date(now.getTime() + SESSION_MS).toISOString(),
      now.toISOString(),
      userAgent.slice(0, 200),
    )
    .run();
  return cookie(SESSION_COOKIE, token, SESSION_MS / 1000);
}

/** The signed-in browser's member, with current access. Sessions slide while in use. */
export async function authenticateBrowser(
  request: Request,
  env: Db,
): Promise<Identity> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length !== 43) throw new AppError(401, "Sign in");
  const key = await hash(token);
  const now = new Date();
  const row = await env.DB.prepare(
    "SELECT auth_sessions.email,last_seen_at,last_active_at FROM auth_sessions JOIN members ON members.email=auth_sessions.email WHERE hash=? AND expires_at>?",
  )
    .bind(key, now.toISOString())
    .first<{
      email: string;
      last_seen_at: string;
      last_active_at: string | null;
    }>();
  if (!row) throw new AppError(401, "Sign in");
  const identity = await loadIdentity(env, row.email);
  const updates: D1PreparedStatement[] = [];
  if (now.getTime() - Date.parse(row.last_seen_at) > SLIDE_MS)
    updates.push(
      env.DB.prepare(
        "UPDATE auth_sessions SET last_seen_at=?, expires_at=? WHERE hash=?",
      ).bind(
        now.toISOString(),
        new Date(now.getTime() + SESSION_MS).toISOString(),
        key,
      ),
    );
  if (
    !row.last_active_at ||
    now.getTime() - Date.parse(row.last_active_at) > ACTIVE_MS
  )
    updates.push(
      env.DB.prepare("UPDATE members SET last_active_at=? WHERE email=?").bind(
        now.toISOString(),
        row.email,
      ),
    );
  if (updates.length) await env.DB.batch(updates);
  return identity;
}

/** The member behind an API key on /mcp. Keys are never accepted by the browser API. */
export async function authenticateKey(
  request: Request,
  env: Db,
): Promise<Identity & { keyId: string }> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (token.length < 32 || token.length > 256)
    throw new AppError(401, "Provide an API key from Settings → API keys");
  const row = await env.DB.prepare(
    "SELECT id,email FROM api_keys WHERE hash=? AND revoked_at IS NULL AND expires_at>?",
  )
    .bind(await hash(token), new Date().toISOString())
    .first<{ id: string; email: string }>();
  if (!row) throw new AppError(401, "API key is invalid, expired or revoked");
  return { ...(await loadIdentity(env, row.email)), keyId: row.id };
}

/** Ends this browser's session, or every session the member has. Returns a clearing cookie. */
export async function signOut(request: Request, env: Db, everywhere: boolean) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token)
    await env.DB.prepare(
      everywhere
        ? "DELETE FROM auth_sessions WHERE email=(SELECT email FROM auth_sessions WHERE hash=?1)"
        : "DELETE FROM auth_sessions WHERE hash=?1",
    )
      .bind(await hash(token))
      .run();
  return cookie(SESSION_COOKIE, "", 0);
}

/** A single-use sign-in link token, valid for 15 minutes (operator bootstrap and recovery). */
export async function createLink(env: Db, email: string) {
  const token = secret();
  await env.DB.prepare(
    "INSERT INTO signin_links (hash,email,expires_at) VALUES (?,?,?)",
  )
    .bind(
      await hash(token),
      email,
      new Date(Date.now() + LINK_MS).toISOString(),
    )
    .run();
  return token;
}

/** Exchanges a sign-in link for a session; returns its Set-Cookie, or null if unusable. */
export async function redeemLink(env: Db, token: string, userAgent: string) {
  if (token.length !== 43) return null;
  const row = await env.DB.prepare(
    "UPDATE signin_links SET used_at=?1 WHERE hash=?2 AND used_at IS NULL AND expires_at>?1 RETURNING email",
  )
    .bind(new Date().toISOString(), await hash(token))
    .first<{ email: string }>();
  if (!row) return null;
  await loadIdentity(env, row.email);
  return createSession(env, row.email, userAgent);
}
