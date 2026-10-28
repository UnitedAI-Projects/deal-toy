import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { loadIdentity } from "./access";
import { googleCallback, googleStart } from "./google";
import { member } from "./test-helpers";

const origin = "https://example.test";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: unknown[] };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  keys = await generateKeyPair("RS256");
  jwks = {
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "g1", alg: "RS256" }],
  };
});
afterEach(() => vi.restoreAllMocks());

let ip = 0;
const nextIp = () => `203.0.113.${++ip}`;
async function start(address = nextIp()) {
  const response = await googleStart(
    new Request(`${origin}/api/auth/google/start`, {
      headers: { "CF-Connecting-IP": address },
    }),
    env,
  );
  const location = new URL(response.headers.get("Location") ?? "", origin);
  const cookie = (response.headers.get("Set-Cookie") ?? "").split(";")[0];
  return { response, location, cookie, address };
}
function idToken(
  claims: Record<string, unknown>,
  audience = env.GOOGLE_CLIENT_ID,
) {
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "g1" })
    .setIssuer("https://accounts.google.com")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime((claims.exp as string | number | undefined) ?? "5m")
    .sign(keys.privateKey);
}
/** Google's token endpoint and certificates, answering with the given ID token. */
function mockGoogle(token: string | null) {
  const calls: { url: string; body: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json(jwks);
    if (url === "https://oauth2.googleapis.com/token") {
      calls.push({ url, body: String(init?.body ?? "") });
      return token
        ? Response.json({ id_token: token, access_token: "x" })
        : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  return calls;
}
async function callback(
  flow: Awaited<ReturnType<typeof start>>,
  claims: Record<string, unknown> | null,
  options: { state?: string; cookie?: string | null; audience?: string } = {},
) {
  const nonce = flow.location.searchParams.get("nonce");
  const calls = mockGoogle(
    claims ? await idToken({ nonce, ...claims }, options.audience) : null,
  );
  const state = options.state ?? flow.location.searchParams.get("state");
  const cookie = options.cookie === undefined ? flow.cookie : options.cookie;
  const response = await googleCallback(
    new Request(
      `${origin}/api/auth/google/callback?state=${state}&code=code-1`,
      {
        headers: {
          "CF-Connecting-IP": flow.address,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
    ),
    env,
  );
  const cookies = response.headers.getSetCookie();
  return {
    location: response.headers.get("Location"),
    session: cookies.find((c) => c.startsWith("__Host-mantel_session=")),
    cookies,
    calls,
  };
}

describe("Google sign-in", () => {
  it("start sets a state cookie and redirects with PKCE", async () => {
    const { response, location } = await start();
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    const p = location.searchParams;
    expect(p.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${origin}/api/auth/google/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("prompt")).toBe("select_account");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const set = response.headers.get("Set-Cookie") ?? "";
    expect(set).toMatch(/^__Host-mantel_oauth=/);
    for (const attribute of [
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=600",
    ])
      expect(set).toContain(attribute);
    expect(set).not.toContain(p.get("code_challenge")!);
  });
  it("creates a Demo member on first sign-in and signs them in", async () => {
    const flow = await start();
    const result = await callback(flow, {
      sub: "sub-new",
      email: "New.Person@Example.test",
      name: "New Person",
    });
    expect(result.location).toBe("/");
    expect(result.session).toBeDefined();
    expect(result.calls[0].body).toContain("code_verifier=");
    expect(result.calls[0].body).toContain("grant_type=authorization_code");
    const row = await env.DB.prepare(
      "SELECT email,name,owner,level_id,google_sub FROM members WHERE google_sub='sub-new'",
    ).first();
    expect(row).toEqual({
      email: "new.person@example.test",
      name: "New Person",
      owner: 0,
      level_id: "level-demo",
      google_sub: "sub-new",
    });
    expect(
      result.cookies.some((c) => c.startsWith("__Host-mantel_oauth=;")),
    ).toBe(true);
  });
  it("links an existing unlinked member by verified email", async () => {
    await member("owner@example.test", { owner: true, level: "Admin" });
    const result = await callback(await start(), {
      sub: "sub-owner",
      email: "owner@example.test",
    });
    expect(result.session).toBeDefined();
    const identity = await loadIdentity(env, "owner@example.test");
    expect(identity.owner).toBe(true);
    const again = await callback(await start(), {
      sub: "sub-owner",
      email: "owner@example.test",
    });
    expect(again.session).toBeDefined();
  });
  it("refuses a second Google subject for an already linked email", async () => {
    await callback(await start(), {
      sub: "sub-first",
      email: "taken@example.test",
    });
    const result = await callback(await start(), {
      sub: "sub-second",
      email: "taken@example.test",
    });
    expect(result.location).toBe("/?auth_error=google");
    expect(result.session).toBeUndefined();
  });
  it("rejects forged Google callbacks", async () => {
    const claims = { sub: "sub-forged", email: "forged@example.test" };
    const cases: [
      string,
      Promise<Awaited<ReturnType<typeof callback>>>,
      string,
    ][] = [
      [
        "missing cookie",
        start().then((f) => callback(f, claims, { cookie: null })),
        "state",
      ],
      [
        "state mismatch",
        start().then((f) => callback(f, claims, { state: "x".repeat(43) })),
        "state",
      ],
      ["token refused", start().then((f) => callback(f, null)), "google"],
      [
        "wrong audience",
        start().then((f) => callback(f, claims, { audience: "other" })),
        "google",
      ],
      [
        "wrong nonce",
        start().then((f) => callback(f, { ...claims, nonce: "n".repeat(43) })),
        "google",
      ],
      [
        "expired",
        start().then((f) =>
          callback(f, { ...claims, exp: Math.floor(Date.now() / 1000) - 600 }),
        ),
        "google",
      ],
      [
        "unverified",
        start().then((f) => callback(f, { ...claims, email_verified: false })),
        "unverified",
      ],
    ];
    for (const [name, pending, code] of cases) {
      const result = await pending;
      expect(result.location, name).toBe(`/?auth_error=${code}`);
      expect(result.session, name).toBeUndefined();
    }
    expect(
      await env.DB.prepare(
        "SELECT email FROM members WHERE email='forged@example.test'",
      ).first(),
    ).toBeNull();
  });
  it("refuses suspended members", async () => {
    await member("paused@example.test", { status: "suspended" });
    const result = await callback(await start(), {
      sub: "sub-paused",
      email: "paused@example.test",
    });
    expect(result.location).toBe("/?auth_error=suspended");
    expect(result.session).toBeUndefined();
  });
  it("rate limits repeated starts", async () => {
    const address = nextIp();
    const locations: string[] = [];
    for (let i = 0; i < 21; i++)
      locations.push(
        (await start(address)).response.headers.get("Location") ?? "",
      );
    expect(locations[0]).toContain("accounts.google.com");
    expect(locations[20]).toBe("/?auth_error=rate");
  });
});
