import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiKey, member } from "./test-helpers";

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
