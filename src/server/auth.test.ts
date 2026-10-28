import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createLink, createSession } from "./auth";
import { hash } from "./core";
import { member } from "./test-helpers";

const origin = "https://example.test";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const cookieValue = (setCookie: string) => setCookie.split(";")[0];
async function signedIn(email: string) {
  return cookieValue(await createSession(env, email, "test"));
}
function api(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${origin}${path}`, init);
}
async function key(email: string) {
  const value = `mtl_${crypto.randomUUID()}${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO api_keys (id,email,name,prefix,hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      email,
      "test",
      value.slice(0, 8),
      await hash(value),
      new Date().toISOString(),
      "2099-01-01T00:00:00.000Z",
    )
    .run();
  return value;
}
const mcpList = (headers: Record<string, string>) =>
  api("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
const session = (cookie?: string) =>
  api("/api/session", cookie ? { headers: { Cookie: cookie } } : {});
const signOut = (cookie: string, body: object = {}) =>
  api("/api/auth/signout", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

const redeem = (
  token: string,
  headers: Record<string, string> = { Origin: origin },
) =>
  api("/api/auth/link", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ token }),
  });

describe("Sign-in links", () => {
  it("create a session once, through a same-origin POST", async () => {
    await member("link@x.test");
    const token = await createLink(env, "link@x.test");
    // A plain GET never redeems the link; the token still works below.
    const viaGet = await api(`/api/auth/link?token=${token}`, {
      redirect: "manual",
    });
    expect(viaGet.headers.get("Set-Cookie")).toBeNull();
    expect((await redeem(token, { Origin: "https://evil.test" })).status).toBe(
      403,
    );
    const first = await redeem(token);
    expect(first.status).toBe(200);
    const set = first.headers.get("Set-Cookie") ?? "";
    expect(set).toMatch(/^__Host-mantel_session=[A-Za-z0-9_-]{43};/);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
      expect(set).toContain(attribute);
    expect(await (await session(cookieValue(set))).json()).toMatchObject({
      email: "link@x.test",
      owner: false,
    });
    const second = await redeem(token);
    expect(second.status).toBe(401);
    expect(second.headers.get("Set-Cookie")).toBeNull();
  });
  it("reject expired links and sessions", async () => {
    await member("old@x.test");
    const token = await createLink(env, "old@x.test");
    await env.DB.prepare("UPDATE signin_links SET expires_at=? WHERE hash=?")
      .bind("2000-01-01T00:00:00.000Z", await hash(token))
      .run();
    expect((await redeem(token)).status).toBe(401);
    const cookie = await signedIn("old@x.test");
    await env.DB.prepare("UPDATE auth_sessions SET expires_at=? WHERE email=?")
      .bind("2000-01-01T00:00:00.000Z", "old@x.test")
      .run();
    expect((await session(cookie)).status).toBe(401);
  });
});

describe("Sessions", () => {
  it("sign out ends this session, and everywhere ends all of them", async () => {
    await member("out@x.test");
    const a = await signedIn("out@x.test");
    const b = await signedIn("out@x.test");
    const out = await signOut(a);
    expect(out.status).toBe(200);
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await session(a)).status).toBe(401);
    expect((await session(b)).status).toBe(200);
    const c = await signedIn("out@x.test");
    expect((await signOut(c, { everywhere: true })).status).toBe(200);
    for (const cookie of [b, c])
      expect((await session(cookie)).status).toBe(401);
  });
  it("suspension ends existing sessions and keys", async () => {
    await member("bye@x.test", { level: "Maker" });
    const cookie = await signedIn("bye@x.test");
    const bearer = { Authorization: `Bearer ${await key("bye@x.test")}` };
    expect((await session(cookie)).status).toBe(200);
    expect((await mcpList(bearer)).status).toBe(200);
    await env.DB.prepare("UPDATE members SET status='suspended' WHERE email=?")
      .bind("bye@x.test")
      .run();
    expect((await session(cookie)).status).toBe(403);
    expect((await mcpList(bearer)).status).toBe(403);
  });
  it("cookie writes require a same-origin Origin", async () => {
    await member("csrf@x.test");
    const cookie = await signedIn("csrf@x.test");
    const write = (headers: Record<string, string>) =>
      api("/api/tools/projects_list", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          ...headers,
        },
        body: "{}",
      });
    expect((await write({})).status).toBe(403);
    expect((await write({ Origin: "https://evil.test" })).status).toBe(403);
    expect((await write({ Origin: origin })).status).toBe(200);
  });
  it("accept keys only on /mcp and cookies only on /api", async () => {
    await member("split@x.test");
    const cookie = await signedIn("split@x.test");
    const bearer = await key("split@x.test");
    const viaKey = await api("/api/session", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(viaKey.status).toBe(401);
    expect((await mcpList({ Cookie: cookie })).status).toBe(401);
    expect((await session()).status).toBe(401);
  });
  it("store only hashes of session and link secrets", async () => {
    await member("hash@x.test");
    const cookie = await signedIn("hash@x.test");
    const secret = cookie.split("=")[1];
    const link = await createLink(env, "hash@x.test");
    const dump = JSON.stringify([
      (await env.DB.prepare("SELECT * FROM auth_sessions").all()).results,
      (await env.DB.prepare("SELECT * FROM signin_links").all()).results,
    ]);
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain(link);
    expect(dump).toContain(await hash(secret));
  });
});
