import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticate } from "./auth";

const issuer = "https://test-team.cloudflareaccess.com";
const audience = "test-deal-toy-audience";
const accessEnv = { ...env, ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: unknown[] };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO members VALUES ('access@example.test','admin',1),('inactive@example.test','maker',0)",
  ).run();
  keys = await generateKeyPair("RS256");
  jwks = {
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" }],
  };
});
afterEach(() => vi.restoreAllMocks());
async function assertion(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ email: "ACCESS@example.test", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}
function mockCertificates() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    expect([
      `${issuer}/cdn-cgi/access/certs`,
      "https://other-team.cloudflareaccess.com/cdn-cgi/access/certs",
    ]).toContain(String(url));
    return Response.json(jwks);
  });
}
function request(jwt: string, bearer?: string) {
  return new Request("https://example.test/api/session", {
    headers: {
      "Cf-Access-Jwt-Assertion": jwt,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  });
}
describe("Cloudflare Access identity", () => {
  it("verifies a signed identity and prefers it over a stale browser token", async () => {
    mockCertificates();
    expect(
      await authenticate(request(await assertion(), "stale"), accessEnv),
    ).toEqual({ email: "access@example.test", role: "admin" });
  });
  it("rejects a JWT for another application or issuer", async () => {
    mockCertificates();
    for (const config of [
      { ...accessEnv, ACCESS_AUD: "another-app" },
      {
        ...accessEnv,
        ACCESS_TEAM_DOMAIN: "https://other-team.cloudflareaccess.com",
      },
    ])
      await expect(
        authenticate(request(await assertion()), config),
      ).rejects.toThrow("Invalid sign-in");
  });
  it("rejects expired assertions", async () => {
    mockCertificates();
    const jwt = await new SignJWT({ email: "access@example.test" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(1)
      .sign(keys.privateKey);
    await expect(authenticate(request(jwt), accessEnv)).rejects.toThrow(
      "Invalid sign-in",
    );
  });
  it("rejects forged assertions instead of falling back to a bearer token", async () => {
    await expect(
      authenticate(
        request("forged", "unused-token-with-thirty-two-characters"),
        accessEnv,
      ),
    ).rejects.toThrow("Invalid sign-in");
  });
  it("keeps membership enforcement after Google authentication", async () => {
    mockCertificates();
    for (const email of ["inactive@example.test", "unknown@example.test"])
      await expect(
        authenticate(request(await assertion({ email })), accessEnv),
      ).rejects.toThrow("Membership is inactive");
  });
});
