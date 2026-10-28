import { createRemoteJWKSet, jwtVerify } from "jose";
import { loadIdentity } from "./access";
import { cookie, createSession, readCookie, secret } from "./auth";
import { AppError } from "./core";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const CERTS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const STATE_COOKIE = "__Host-mantel_oauth";
type GoogleEnv = Pick<
  Env,
  "DB" | "AUTH_LIMITER" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"
>;
type Failure =
  "state" | "google" | "unverified" | "suspended" | "rate" | "unavailable";

function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}
const fail = (code: Failure) =>
  redirect(`/?auth_error=${code}`, [cookie(STATE_COOKIE, "", 0)]);
async function limited(request: Request, env: GoogleEnv) {
  const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return !(await env.AUTH_LIMITER.limit({ key })).success;
}
async function challenge(verifier: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
const callbackUrl = (request: Request) =>
  `${new URL(request.url).origin}/api/auth/google/callback`;

/** Sends the browser to Google with PKCE, state and nonce kept in a short-lived cookie. */
export async function googleStart(request: Request, env: GoogleEnv) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return fail("unavailable");
  if (await limited(request, env)) return fail("rate");
  const state = secret();
  const verifier = secret();
  const nonce = secret();
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(request),
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state,
    nonce,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return redirect(url.toString(), [
    cookie(STATE_COOKIE, `${state}.${verifier}.${nonce}`, 600),
  ]);
}

/**
 * Finishes Google sign-in: checks state, exchanges the code, verifies the ID token and signs
 * the member in. A verified email links to an existing member only once; after that the
 * member is found by Google's subject id, so another Google account cannot take it over.
 */
export async function googleCallback(request: Request, env: GoogleEnv) {
  if (await limited(request, env)) return fail("rate");
  const url = new URL(request.url);
  const stored = readCookie(request, STATE_COOKIE)?.split(".");
  const state = url.searchParams.get("state");
  if (!stored || stored.length !== 3 || !state || state !== stored[0])
    return fail("state");
  // Cancelling on Google's screen returns the person to the sign-in card.
  if (url.searchParams.get("error"))
    return redirect("/", [cookie(STATE_COOKIE, "", 0)]);
  const [, verifier, nonce] = stored;
  const exchange = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code") ?? "",
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(request),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!exchange.ok) return fail("google");
  const { id_token } = (await exchange.json()) as { id_token?: string };
  let claims: Record<string, unknown>;
  try {
    claims = (
      await jwtVerify(id_token ?? "", CERTS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: env.GOOGLE_CLIENT_ID,
        algorithms: ["RS256"],
      })
    ).payload;
  } catch {
    return fail("google");
  }
  if (claims.nonce !== nonce || typeof claims.sub !== "string")
    return fail("google");
  if (claims.email_verified !== true || typeof claims.email !== "string")
    return fail("unverified");
  const email = await link(env, {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === "string" ? claims.name.slice(0, 120) : "",
  });
  if (!email) return fail("google");
  try {
    await loadIdentity(env, email);
  } catch (error) {
    if (error instanceof AppError && error.status === 403)
      return fail("suspended");
    throw error;
  }
  return redirect("/", [
    await createSession(env, email, request.headers.get("User-Agent") ?? ""),
    cookie(STATE_COOKIE, "", 0),
  ]);
}

/** Returns the member's email for this Google account, creating a Demo member if needed. */
async function link(
  env: GoogleEnv,
  google: { sub: string; email: string; name: string },
): Promise<string | null> {
  // Email is the member's permanent key (projects reference it), so a member found by
  // subject keeps the email they first signed in with.
  const bySub = await env.DB.prepare(
    "SELECT email FROM members WHERE google_sub=?",
  )
    .bind(google.sub)
    .first<{ email: string }>();
  if (bySub) return bySub.email;
  const linked = await env.DB.prepare(
    "UPDATE members SET google_sub=?1, name=CASE name WHEN '' THEN ?2 ELSE name END WHERE email=?3 AND google_sub IS NULL RETURNING email",
  )
    .bind(google.sub, google.name, google.email)
    .first<{ email: string }>();
  if (linked) return linked.email;
  const created = await env.DB.prepare(
    `INSERT INTO members (email,name,level_id,owner,status,google_sub,created_at)
     SELECT ?1,?2,id,0,'active',?3,?4 FROM levels WHERE is_default=1 LIMIT 1
     ON CONFLICT DO NOTHING RETURNING email`,
  )
    .bind(google.email, google.name, google.sub, new Date().toISOString())
    .first<{ email: string }>();
  // No row: the email belongs to a member linked to a different Google account.
  return created?.email ?? null;
}
