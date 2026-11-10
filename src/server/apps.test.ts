import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  appPath,
  appPolicy,
  forgetManifest,
  MANIFEST_KEY,
  mediaType,
} from "./apps";
import { cookieFor, member } from "./test-helpers";

const origin = "https://example.test";
const html = `<!DOCTYPE html><html><head><script type="module">import init from './a-0123456789abcdef.js'; await init();</script></head><body></body></html>`;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await member("apps@ap.test");
  await env.ARTIFACTS.put(
    MANIFEST_KEY,
    JSON.stringify({ manteldocs: { tree: "t1" } }),
  );
  await env.ARTIFACTS.put("apps/manteldocs/t1/index.html", html);
  await env.ARTIFACTS.put(
    "apps/manteldocs/t1/a-0123456789abcdef_bg.wasm",
    new Uint8Array([0, 97, 115, 109]),
  );
  forgetManifest();
});

describe("app paths", () => {
  it("maps engine paths and refuses others", () => {
    expect(appPath("/apps/manteldocs/")).toEqual({
      engine: "manteldocs",
      path: "index.html",
    });
    expect(appPath("/apps/manteldocs")).toEqual({
      engine: "manteldocs",
      path: "index.html",
    });
    expect(appPath("/apps/mantelcad/fonts/a.ttf")).toEqual({
      engine: "mantelcad",
      path: "fonts/a.ttf",
    });
    expect(appPath("/apps/unknown/x")).toBeNull();
    expect(appPath("/app/manteldocs/")).toBeNull();
    expect(() => appPath("/apps/manteldocs/a/../../b")).toThrow();
    expect(() => appPath("/apps/manteldocs/%2e%2e/b")).toThrow();
    expect(mediaType("x_bg.wasm")).toBe("application/wasm");
  });

  it("allows exactly the page's inline scripts and only Mantel to frame it", async () => {
    const csp = await appPolicy(html);
    expect(csp).toMatch(
      /script-src 'self' 'wasm-unsafe-eval' 'sha256-[A-Za-z0-9+/=]+'/,
    );
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("unsafe-inline' 'wasm");
  });
});

describe("serving apps", () => {
  it("serves a deployed app to people signed in", async () => {
    const cookie = await cookieFor("apps@ap.test");
    const page = await exports.default.fetch(
      `${origin}/apps/manteldocs/?host=parent`,
      { headers: { Cookie: cookie } },
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Content-Security-Policy")).toContain("sha256-");
    expect(await page.text()).toBe(html);
    const wasm = await exports.default.fetch(
      `${origin}/apps/manteldocs/a-0123456789abcdef_bg.wasm`,
      { headers: { Cookie: cookie } },
    );
    expect(wasm.headers.get("Content-Type")).toBe("application/wasm");
    expect(wasm.headers.get("Cache-Control")).toContain("immutable");
  });

  it("needs a sign-in, and a deployed engine", async () => {
    const anon = await exports.default.fetch(`${origin}/apps/manteldocs/`);
    expect(anon.status).toBe(401);
    const cookie = await cookieFor("apps@ap.test");
    const missing = await exports.default.fetch(`${origin}/apps/mantelcad/`, {
      headers: { Cookie: cookie },
    });
    expect(missing.status).toBe(404);
  });
});
