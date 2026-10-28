import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError, hash, type Identity } from "./core";
export async function authenticate(
  request: Request,
  env: Pick<Env, "DB"> & { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string },
): Promise<Identity> {
  let email: string | undefined;
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  const authorization = request.headers.get("Authorization");
  // The current Google identity wins over a token left in browser session storage.
  if (assertion && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const issuer = env.ACCESS_TEAM_DOMAIN;
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))
      throw new AppError(503, "Identity provider is not configured");
    try {
      const { payload } = await jwtVerify(
        assertion,
        createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
        { issuer, audience: env.ACCESS_AUD, algorithms: ["RS256"] },
      );
      if (typeof payload.email === "string")
        email = payload.email.toLowerCase();
    } catch {
      throw new AppError(401, "Invalid sign-in");
    }
  } else if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7);
    if (token.length < 32 || token.length > 256)
      throw new AppError(401, "Invalid access token");
    const row = await env.DB.prepare(
      "SELECT email FROM tokens WHERE hash=? AND expires_at>?",
    )
      .bind(await hash(token), new Date().toISOString())
      .first<{ email: string }>();
    email = row?.email;
  }
  if (!email)
    throw new AppError(401, "Sign in or provide a personal access token");
  const member = await env.DB.prepare(
    "SELECT email,role FROM members WHERE email=? AND active=1",
  )
    .bind(email)
    .first<Identity>();
  if (!member) throw new AppError(403, "Membership is inactive");
  return member;
}
