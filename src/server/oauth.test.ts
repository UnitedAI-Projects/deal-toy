import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  approve,
  begin,
  cookieFor,
  cookiePairs,
  decide,
  exchange,
  member,
} from "./test-helpers";

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

describe("tokens other than OAuth", () => {
  it("refuses a Mantel API key on /mcp and points to sign-in", async () => {
    await member("key@oauth.test", { level: "Maker" });
    const r = await mcpWith(`mtl_${"x".repeat(43)}`);
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
  });
  it("has no API key settings", async () => {
    await member("nokeys@oauth.test", { level: "Admin" });
    const session = await cookieFor("nokeys@oauth.test");
    for (const method of ["GET", "POST"])
      expect(
        (
          await exports.default.fetch(`${origin}/api/settings/keys`, {
            method,
            headers: {
              Cookie: session,
              Origin: origin,
              "Content-Type": "application/json",
            },
            body: method === "POST" ? JSON.stringify({ name: "x" }) : undefined,
          })
        ).status,
      ).toBe(404);
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

async function connect(
  email: string,
  level: "Demo" | "Maker" | "Admin" = "Maker",
  options: Parameters<typeof member>[1] = {},
) {
  await member(email, { level, ...options });
  const session = await cookieFor(email);
  return { session, ...(await exchange(await approve(session, email), email)) };
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
  it("consent page lets a real browser post the form and follow the redirect", async () => {
    await member("browser@oauth.test", { level: "Maker" });
    const flow = await begin(await cookieFor("browser@oauth.test"));
    // no-referrer would make browsers send "Origin: null" with the form post.
    expect(flow.page.headers.get("Referrer-Policy")).toBe("same-origin");
    // Browsers apply form-action to the redirect after the post, so allow the app's address.
    const csp = flow.page.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/form-action 'self' https:\/\/client\.test(;|$)/);
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

function settings(cookie: string, path: string, method = "GET") {
  return exports.default.fetch(`${origin}/api/settings${path}`, {
    method,
    headers: { Cookie: cookie, Origin: origin },
  });
}
type ConnectedApp = { id: string; name: string; connected_at: string };

describe("connected apps", () => {
  it("lists connected apps and disconnecting cuts access at once", async () => {
    const t = await connect("apps@oauth.test", "Maker");
    const apps = await (
      await settings(t.session, "/connected-apps")
    ).json<ConnectedApp[]>();
    expect(apps).toEqual([expect.objectContaining({ name: "Test client" })]);
    expect(
      Math.abs(Date.parse(apps[0].connected_at) - Date.now()),
    ).toBeLessThan(60_000);
    const removed = await settings(
      t.session,
      `/connected-apps/${apps[0].id}`,
      "DELETE",
    );
    expect(await removed.json()).toEqual({ ok: true });
    expect((await mcpWith(t.access_token)).status).toBe(401);
    expect(await (await settings(t.session, "/connected-apps")).json()).toEqual(
      [],
    );
  });
  it("are listed for a demo-level member", async () => {
    const t = await connect("appsdemo@oauth.test", "Demo");
    const r = await settings(t.session, "/connected-apps");
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveLength(1);
  });
  it("cannot disconnect another member's app", async () => {
    const mine = await connect("mine@oauth.test", "Maker");
    const theirs = await connect("theirs@oauth.test", "Maker");
    const [app] = await (
      await settings(theirs.session, "/connected-apps")
    ).json<ConnectedApp[]>();
    await settings(mine.session, `/connected-apps/${app.id}`, "DELETE");
    expect((await mcpWith(theirs.access_token)).status).toBe(200);
  });
  it("rejects a malformed app id", async () => {
    await member("badid@oauth.test", { level: "Maker" });
    const cookie = await cookieFor("badid@oauth.test");
    const r = await settings(cookie, "/connected-apps/a%20b", "DELETE");
    expect(r.status).toBe(400);
  });
  it("need a browser session, not a token", async () => {
    const t = await connect("apptoken@oauth.test", "Maker");
    const r = await get("/api/settings/connected-apps", {
      Authorization: `Bearer ${t.access_token}`,
    });
    expect(r.status).toBe(401);
  });
});

const auditFor = async (email: string) =>
  (
    await env.DB.prepare(
      "SELECT actor,action,detail FROM audit_events WHERE target=? AND action LIKE 'app.%' ORDER BY created_at, rowid",
    )
      .bind(email)
      .all<{ actor: string; action: string; detail: string }>()
  ).results;

describe("staying connected", () => {
  it("keeps the working connection while a new sign-in for the same app is unfinished", async () => {
    const t = await connect("keep@oauth.test", "Maker");
    // Allow is clicked again, but the code never reaches the app.
    await approve(t.session, "keep@oauth.test", t.clientId);
    expect((await mcpWith(t.access_token)).status).toBe(200);
    // The unfinished sign-in is not listed as a second app.
    const apps = await (
      await settings(t.session, "/connected-apps")
    ).json<ConnectedApp[]>();
    expect(apps).toHaveLength(1);
  });
  it("replaces the old connection once the new sign-in finishes", async () => {
    const t = await connect("swap@oauth.test", "Maker");
    const fresh = await exchange(
      await approve(t.session, "swap@oauth.test", t.clientId),
      "swap@oauth.test",
    );
    expect((await mcpWith(fresh.access_token)).status).toBe(200);
    expect((await mcpWith(t.access_token)).status).toBe(401);
    const apps = await (
      await settings(t.session, "/connected-apps")
    ).json<ConnectedApp[]>();
    expect(apps).toHaveLength(1);
  });
  it("records connecting, replacing and disconnecting in the audit log", async () => {
    const t = await connect("log@oauth.test", "Maker");
    await exchange(
      await approve(t.session, "log@oauth.test", t.clientId),
      "log@oauth.test",
    );
    const [app] = await (
      await settings(t.session, "/connected-apps")
    ).json<ConnectedApp[]>();
    await settings(t.session, `/connected-apps/${app.id}`, "DELETE");
    const events = await auditFor("log@oauth.test");
    expect(events.map((e) => e.action)).toEqual([
      "app.connect",
      "app.connect",
      "app.disconnect",
    ]);
    expect(events.every((e) => e.actor === "log@oauth.test")).toBe(true);
    expect(JSON.parse(events[1].detail)).toMatchObject({
      app: "Test client",
      replaced: 1,
    });
    expect(JSON.parse(events[2].detail)).toMatchObject({ app: "Test client" });
  });
  it("records an app signing itself out, which ends the connection", async () => {
    const t = await connect("signout@oauth.test", "Maker");
    const r = await exports.default.fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: t.refresh_token,
        token_type_hint: "refresh_token",
        client_id: t.clientId,
      }),
    });
    expect(r.status).toBe(200);
    expect((await mcpWith(t.access_token)).status).toBe(401);
    const events = await auditFor("signout@oauth.test");
    expect(events.map((e) => e.action)).toEqual(["app.connect", "app.signout"]);
    expect(JSON.parse(events[1].detail)).toMatchObject({ app: "Test client" });
  });
  it("disconnecting an app also cancels its unfinished sign-ins", async () => {
    const t = await connect("cut@oauth.test", "Maker");
    const pending = await approve(t.session, "cut@oauth.test", t.clientId);
    const [app] = await (
      await settings(t.session, "/connected-apps")
    ).json<ConnectedApp[]>();
    await settings(t.session, `/connected-apps/${app.id}`, "DELETE");
    const late = await exports.default.fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: pending.code,
        redirect_uri: "https://client.test/cb",
        client_id: t.clientId,
        code_verifier: pending.flow.verifier,
        resource: `${origin}/mcp`,
      }),
    });
    expect(late.status).toBe(400);
  });
  it("reports disconnecting an app that is not yours as not found", async () => {
    const mine = await connect("mine2@oauth.test", "Maker");
    const theirs = await connect("theirs2@oauth.test", "Maker");
    const [app] = await (
      await settings(theirs.session, "/connected-apps")
    ).json<ConnectedApp[]>();
    const r = await settings(
      mine.session,
      `/connected-apps/${app.id}`,
      "DELETE",
    );
    expect(r.status).toBe(404);
    expect(await auditFor("mine2@oauth.test")).toHaveLength(1);
  });
});
