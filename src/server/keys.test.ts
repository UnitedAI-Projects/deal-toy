import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { hash } from "./core";
import { cookieFor, member } from "./test-helpers";

const origin = "https://example.test";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
function settings(
  cookie: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return exports.default.fetch(`${origin}/api/settings${path}`, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const create = async (cookie: string, name = "Laptop", days = 90) =>
  (await settings(cookie, "/keys", "POST", { name, days })).json() as Promise<{
    id: string;
    name: string;
    key: string;
    expires_at: string;
    error?: string;
  }>;
const mcp = (key: string) =>
  exports.default.fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

describe("API keys", () => {
  it("are shown once, stored as a hash and work on /mcp", async () => {
    await member("keys@k.test", { level: "Maker" });
    const cookie = await cookieFor("keys@k.test");
    const created = await create(cookie, "MacBook Claude Code", 30);
    expect(created.key).toMatch(/^mtl_[A-Za-z0-9_-]{43}$/);
    expect(created.name).toBe("MacBook Claude Code");
    expect(Date.parse(created.expires_at) - Date.now()).toBeGreaterThan(
      29 * 86400_000,
    );
    expect(Date.parse(created.expires_at) - Date.now()).toBeLessThan(
      31 * 86400_000,
    );
    expect((await mcp(created.key)).status).toBe(200);
    const listed = await (await settings(cookie, "/keys")).text();
    expect(listed).not.toContain(created.key);
    expect(JSON.parse(listed)).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "MacBook Claude Code",
        prefix: created.key.slice(0, 8),
      }),
    ]);
    const stored = JSON.stringify(
      (
        await env.DB.prepare(
          "SELECT * FROM api_keys WHERE email='keys@k.test'",
        ).all()
      ).results,
    );
    expect(stored).not.toContain(created.key);
    expect(stored).toContain(await hash(created.key));
  });
  it("stop working when revoked or expired", async () => {
    await member("revoke@k.test", { level: "Maker" });
    const cookie = await cookieFor("revoke@k.test");
    const a = await create(cookie);
    const b = await create(cookie);
    expect((await settings(cookie, `/keys/${a.id}`, "DELETE")).status).toBe(
      200,
    );
    expect((await mcp(a.key)).status).toBe(401);
    await env.DB.prepare("UPDATE api_keys SET expires_at=? WHERE id=?")
      .bind("2000-01-01T00:00:00.000Z", b.id)
      .run();
    expect((await mcp(b.key)).status).toBe(401);
    expect(await (await settings(cookie, "/keys")).json()).toEqual([]);
  });
  it("are limited to ten active keys", async () => {
    await member("many@k.test", { level: "Maker" });
    const cookie = await cookieFor("many@k.test");
    for (let i = 0; i < 10; i++) await create(cookie, `Key ${i}`);
    const eleventh = await settings(cookie, "/keys", "POST", {
      name: "One more",
      days: 90,
    });
    expect(eleventh.status).toBe(409);
    expect(((await eleventh.json()) as { error: string }).error).toBe(
      "You have 10 active keys; revoke one first",
    );
  });
  it("need keys.use, and losing it disables every key", async () => {
    await member("demo@k.test", { level: "Demo" });
    const demoCookie = await cookieFor("demo@k.test");
    expect(
      (await settings(demoCookie, "/keys", "POST", { name: "x", days: 90 }))
        .status,
    ).toBe(403);
    await member("lose@k.test", { level: "Maker" });
    const cookie = await cookieFor("lose@k.test");
    const created = await create(cookie);
    expect((await mcp(created.key)).status).toBe(200);
    await member("lose@k.test", { level: "Maker", revoke: ["keys.use"] });
    expect((await mcp(created.key)).status).toBe(403);
  });
  it("cannot be revoked by another member", async () => {
    await member("one@k.test", { level: "Maker" });
    await member("two@k.test", { level: "Maker" });
    const mine = await create(await cookieFor("one@k.test"));
    const theirs = await settings(
      await cookieFor("two@k.test"),
      `/keys/${mine.id}`,
      "DELETE",
    );
    expect(theirs.status).toBe(404);
    expect((await mcp(mine.key)).status).toBe(200);
  });
  it("record last use at most every five minutes", async () => {
    await member("used@k.test", { level: "Maker" });
    const created = await create(await cookieFor("used@k.test"));
    const lastUsed = async () =>
      (
        await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id=?")
          .bind(created.id)
          .first<{ last_used_at: string | null }>()
      )?.last_used_at;
    expect(await lastUsed()).toBeNull();
    await mcp(created.key);
    const first = await lastUsed();
    expect(first).not.toBeNull();
    const recent = new Date(Date.now() - 2 * 60_000).toISOString();
    await env.DB.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?")
      .bind(recent, created.id)
      .run();
    await mcp(created.key);
    expect(await lastUsed()).toBe(recent);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await env.DB.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?")
      .bind(old, created.id)
      .run();
    await mcp(created.key);
    expect(await lastUsed()).not.toBe(old);
  });
});
