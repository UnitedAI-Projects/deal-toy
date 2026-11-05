import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiKey, cookieFor, member } from "./test-helpers";

const origin = "https://example.test";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const get = (path: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(`${origin}${path}`, { headers });
const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const mcpWith = (token?: string) =>
  exports.default.fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(toolsList),
  });

describe("MCP sign-in discovery", () => {
  it("advertises sign-in on an anonymous /mcp request", async () => {
    const r = await mcpWith();
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toMatch(
      /resource_metadata="https:\/\/example\.test\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
  });
  it("serves protected-resource and authorization-server metadata as JSON", async () => {
    const pr = await (
      await get("/.well-known/oauth-protected-resource/mcp")
    ).json<{ resource: string; scopes_supported: string[] }>();
    expect(pr.resource).toBe("https://example.test/mcp");
    expect(pr.scopes_supported).toEqual(["mantel"]);
    const as = await (
      await get("/.well-known/oauth-authorization-server")
    ).json<Record<string, unknown>>();
    expect(as.authorization_endpoint).toBe("https://example.test/authorize");
    expect(as.token_endpoint).toBe("https://example.test/oauth/token");
    expect(as.registration_endpoint).toBe(
      "https://example.test/oauth/register",
    );
    expect(as.code_challenge_methods_supported).toContain("S256");
  });
});

describe("API keys on /mcp", () => {
  it("still accepts API keys on /mcp", async () => {
    await member("key@oauth.test", { level: "Maker" });
    const r = await mcpWith(await apiKey("key@oauth.test"));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("projects_list");
  });
  it("still refuses a key whose member lost keys.use, naming the API keys permission", async () => {
    await member("nokey@oauth.test", { level: "Maker" });
    const key = await apiKey("nokey@oauth.test");
    await member("nokey@oauth.test", { level: "Maker", revoke: ["keys.use"] });
    const r = await mcpWith(key);
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("API keys");
  });
  it("refuses an unknown key", async () => {
    expect((await mcpWith(`mtl_${"x".repeat(43)}`)).status).toBe(401);
  });
});

describe("client registration", () => {
  it("is rate-limited per address", async () => {
    const register = () =>
      exports.default.fetch(`${origin}/oauth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.77",
        },
        body: JSON.stringify({
          client_name: "Spam",
          redirect_uris: ["https://client.test/cb"],
          token_endpoint_auth_method: "none",
        }),
      });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await register()).status);
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

// A full OAuth connection, the way an MCP client makes one.
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
const cookiePairs = (r: Response) =>
  r.headers.getSetCookie().map((c) => c.split(";")[0]);
async function begin(
  cookie: string | null,
  options: { name?: string; state?: string } = {},
) {
  const clientId = await register(options.name);
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
function decide(
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
async function connect(
  email: string,
  level: "Demo" | "Maker" | "Admin" = "Maker",
  options: Parameters<typeof member>[1] = {},
) {
  await member(email, { level, ...options });
  const session = await cookieFor(email);
  const flow = await begin(session);
  expect(flow.page.status).toBe(200);
  const approved = await decide(flow, [session], "allow");
  expect(approved.status).toBe(302);
  const redirect = new URL(approved.headers.get("Location") ?? "");
  expect(redirect.origin + redirect.pathname).toBe("https://client.test/cb");
  expect(redirect.searchParams.get("state")).toBe("state-1");
  const exchange = await exports.default.fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code") ?? "",
      redirect_uri: "https://client.test/cb",
      client_id: flow.clientId,
      code_verifier: flow.verifier,
      resource: `${origin}/mcp`,
    }),
  });
  expect(exchange.status).toBe(200);
  return {
    session,
    ...(await exchange.json<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>()),
  };
}
async function toolNames(token: string) {
  const r = await mcpWith(token);
  expect(r.status).toBe(200);
  return [...(await r.text()).matchAll(/"name":"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("connecting an app", () => {
  it("connects an active member and the token works on /mcp only", async () => {
    const t = await connect("a@oauth.test", "Maker");
    expect(t.expires_in).toBe(604800);
    expect(t.refresh_token).toBeTruthy();
    expect(await toolNames(t.access_token)).toContain("models_save");
    const api = await get("/api/session", {
      Authorization: `Bearer ${t.access_token}`,
    });
    expect(api.status).toBe(401);
  });
  it("lets a member without keys.use connect", async () => {
    const t = await connect("nokeys@oauth.test", "Maker", {
      revoke: ["keys.use"],
    });
    expect(await toolNames(t.access_token)).toContain("projects_list");
  });
  it("gives a demo-level token read access but no editing or building", async () => {
    const names = await toolNames(
      (await connect("d@oauth.test", "Demo")).access_token,
    );
    expect(names).toContain("projects_list");
    expect(names).not.toContain("models_save");
    expect(names).not.toContain("models_build");
  });
  it("token follows level changes", async () => {
    const t = await connect("change@oauth.test", "Maker");
    expect(await toolNames(t.access_token)).toContain("models_save");
    await member("change@oauth.test", { level: "Demo" });
    expect(await toolNames(t.access_token)).not.toContain("models_save");
  });
  it("refuses a suspended member's token", async () => {
    const t = await connect("susp@oauth.test", "Maker");
    await member("susp@oauth.test", { level: "Maker", status: "suspended" });
    expect((await mcpWith(t.access_token)).status).toBe(403);
  });
  it("shows a suspended member an explanation instead of consent", async () => {
    await member("susp2@oauth.test", { level: "Maker" });
    const session = await cookieFor("susp2@oauth.test");
    await member("susp2@oauth.test", { level: "Maker", status: "suspended" });
    const flow = await begin(session);
    expect(flow.page.status).toBe(403);
    expect(flow.html).toContain("suspended");
    expect(flow.handle).toBe("");
  });
  it("sends an anonymous browser to Google sign-in with a return path", async () => {
    const flow = await begin(null);
    expect(flow.page.status).toBe(302);
    const location = flow.page.headers.get("Location") ?? "";
    expect(location).toBe(
      `/api/auth/google/start?next=${encodeURIComponent(flow.path)}`,
    );
  });
  it("cancel returns access_denied to the client", async () => {
    await member("cancel@oauth.test", { level: "Maker" });
    const session = await cookieFor("cancel@oauth.test");
    const flow = await begin(session, { state: "s-cancel" });
    const r = await decide(flow, [session], "cancel");
    expect(r.status).toBe(302);
    const location = new URL(r.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe("https://client.test/cb");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("s-cancel");
    expect(location.searchParams.get("code")).toBeNull();
  });
  it("consent page names the app, address and account, and escapes client metadata", async () => {
    await member("esc@oauth.test", { level: "Maker" });
    const flow = await begin(await cookieFor("esc@oauth.test"), {
      name: "<img src=x onerror=alert(1)>",
    });
    expect(flow.page.status).toBe(200);
    expect(flow.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(flow.html).not.toContain("<img");
    expect(flow.html).toContain("client.test");
    expect(flow.html).toContain("esc@oauth.test");
    expect(flow.html).not.toContain("<script");
    expect(flow.page.headers.get("Content-Type")).toContain("text/html");
  });
  it("allow without a session does not authorise", async () => {
    await member("nosession@oauth.test", { level: "Maker" });
    const flow = await begin(await cookieFor("nosession@oauth.test"));
    const r = await decide(flow, [], "allow");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(
      `/api/auth/google/start?next=${encodeURIComponent(flow.path)}`,
    );
  });
  it("a consent handle works once", async () => {
    await member("once@oauth.test", { level: "Maker" });
    const session = await cookieFor("once@oauth.test");
    const flow = await begin(session);
    expect((await decide(flow, [session], "allow")).status).toBe(302);
    const again = await decide(flow, [session], "allow");
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("already used");
  });
  it("does not connect a different account than the page named", async () => {
    await member("shown@oauth.test", { level: "Maker" });
    await member("other@oauth.test", { level: "Maker" });
    const flow = await begin(await cookieFor("shown@oauth.test"));
    const r = await decide(
      flow,
      [await cookieFor("other@oauth.test")],
      "allow",
    );
    expect(r.status).toBe(400);
    expect(r.headers.get("Location")).toBeNull();
  });
  it("refuses an approval posted from another site", async () => {
    await member("csrf@oauth.test", { level: "Maker" });
    const session = await cookieFor("csrf@oauth.test");
    const flow = await begin(session);
    const r = await exports.default.fetch(`${origin}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://evil.test",
        Cookie: [session, ...cookiePairs(flow.page)].join("; "),
      },
      body: new URLSearchParams({ handle: flow.handle, action: "allow" }),
    });
    expect(r.status).toBe(403);
  });
});
