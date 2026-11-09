import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { loadIdentity, type Permission } from "./access";
import { createSession } from "./auth";
import type { Context } from "./core";

const LEVEL_IDS = {
  Demo: "level-demo",
  Maker: "level-maker",
  Admin: "level-admin",
} as const;

/** Creates (or resets) a member for a test and returns a context with their current access. */
export async function member(
  email: string,
  options: {
    owner?: boolean;
    level?: keyof typeof LEVEL_IDS;
    allow?: Permission[];
    revoke?: Permission[];
    status?: "active" | "suspended";
    name?: string;
  } = {},
): Promise<Context> {
  const level = LEVEL_IDS[options.level ?? "Maker"];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (email,name,level_id,owner,status,created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET name=excluded.name, level_id=excluded.level_id,
         owner=excluded.owner, status=excluded.status`,
    ).bind(
      email,
      options.name ?? email.split("@")[0],
      level,
      options.owner ? 1 : 0,
      options.status ?? "active",
      new Date().toISOString(),
    ),
    env.DB.prepare("DELETE FROM member_permissions WHERE email=?").bind(email),
    ...(options.allow ?? []).map((p) =>
      env.DB.prepare(
        "INSERT INTO member_permissions VALUES (?,?,'allow')",
      ).bind(email, p),
    ),
    ...(options.revoke ?? []).map((p) =>
      env.DB.prepare(
        "INSERT INTO member_permissions VALUES (?,?,'revoke')",
      ).bind(email, p),
    ),
  ]);
  if (options.status === "suspended")
    return {
      env,
      identity: { email, name: "", owner: false, permissions: new Set() },
    };
  return { env, identity: await loadIdentity(env, email) };
}

/** A browser session cookie (name=value) for a member. */
export async function cookieFor(email: string) {
  return (await createSession(env, email, "test")).split(";")[0];
}

// A full OAuth connection, the way an MCP client makes one.
const origin = "https://example.test";
let address = 0;
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  return { verifier, challenge };
}
async function register(name = "Test client") {
  const r = await exports.default.fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": `198.51.100.${++address}`,
    },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: ["https://client.test/cb"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(r.status).toBe(201);
  return (await r.json<{ client_id: string }>()).client_id;
}
export const cookiePairs = (r: Response) =>
  r.headers.getSetCookie().map((c) => c.split(";")[0]);
export async function begin(
  cookie: string | null,
  options: { name?: string; state?: string; clientId?: string } = {},
) {
  const clientId = options.clientId ?? (await register(options.name));
  const { verifier, challenge } = await pkce();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://client.test/cb",
    scope: "mantel",
    state: options.state ?? "state-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${origin}/mcp`,
  });
  const path = `/authorize?${query}`;
  const page = await exports.default.fetch(`${origin}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const account = /name="account" value="([^"]+)"/.exec(html)?.[1] ?? "";
  return { clientId, verifier, path, page, html, handle, account };
}
export function decide(
  flow: Awaited<ReturnType<typeof begin>>,
  cookies: string[],
  action: "allow" | "cancel",
) {
  return exports.default.fetch(`${origin}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
      Cookie: [...cookies, ...cookiePairs(flow.page)].join("; "),
    },
    body: new URLSearchParams({
      handle: flow.handle,
      return_to: flow.path,
      account: flow.account,
      action,
    }),
  });
}
/** Signs in and clicks Allow; returns the authorization code the app receives. */
export async function approve(
  session: string,
  email: string,
  clientId?: string,
) {
  const flow = await begin(session, { clientId });
  expect(flow.page.status).toBe(200);
  const approved = await decide(flow, [session], "allow");
  expect(approved.status).toBe(302);
  const redirect = new URL(approved.headers.get("Location") ?? "");
  expect(redirect.origin + redirect.pathname).toBe("https://client.test/cb");
  expect(redirect.searchParams.get("state")).toBe("state-1");
  const code = redirect.searchParams.get("code") ?? "";
  // Codes and tokens embed the grant's user id; it must not be the member's email.
  expect(code).not.toContain(email);
  return { code, flow };
}
/** The app's half: swaps the code for its passes. */
export async function exchange(
  approval: Awaited<ReturnType<typeof approve>>,
  email: string,
) {
  const r = await exports.default.fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: approval.code,
      redirect_uri: "https://client.test/cb",
      client_id: approval.flow.clientId,
      code_verifier: approval.flow.verifier,
      resource: `${origin}/mcp`,
    }),
  });
  expect(r.status).toBe(200);
  const tokens = await r.json<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>();
  expect(tokens.access_token).not.toContain(email);
  expect(tokens.refresh_token).not.toContain(email);
  return { clientId: approval.flow.clientId, ...tokens };
}

/** An OAuth access token for /mcp, from a full sign-in as the member. */
export async function mcpToken(email: string) {
  return (await exchange(await approve(await cookieFor(email), email), email))
    .access_token;
}
