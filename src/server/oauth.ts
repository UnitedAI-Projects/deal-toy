import {
  ExternalTokenError,
  OAuthProvider,
} from "@cloudflare/workers-oauth-provider";
import { loadIdentity } from "./access";
import { authenticateKey } from "./auth";
import { AppError, boundedText, failure, secure } from "./core";
import { mcp } from "./mcp";

/** Access tokens last a week; every request still re-reads the member's current access. */
export const ACCESS_TOKEN_TTL = 7 * 86400;
/** Refresh tokens rotate and lapse after 30 days unused, matching browser sessions. */
export const REFRESH_TOKEN_TTL = 30 * 86400;
/** The single scope: a connected app acts as the member, with exactly their access. */
export const SCOPE = "mantel";
/** What a grant (OAuth) or an API key carries to the /mcp handler. */
export type GrantProps = { email: string; keyId?: string };

const resourceFor = (env: Env) => `${env.APP_ORIGIN}/mcp`;

/** Serves /mcp to an authenticated member, whichever way they signed in. */
const mcpHandler = {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    try {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin)
        throw new AppError(403, "Cross-origin requests are not allowed");
      const { email } = (ctx as ExecutionContext & { props: GrantProps }).props;
      // Access is read now, not at sign-in, so level changes and suspensions apply at once.
      const identity = await loadIdentity(env, email);
      let mcpRequest: Request = request;
      if (request.method === "POST")
        mcpRequest = new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: await boundedText(request),
        });
      return secure(await mcp(mcpRequest, { env, identity }));
    } catch (error) {
      return failure(error, url);
    }
  },
} satisfies ExportedHandler<Env>;

/** Accepts Mantel API keys (mtl_…) on /mcp alongside OAuth tokens. */
async function resolveKey({
  token,
  request,
  env,
}: {
  token: string;
  request: Request;
  env: Env;
}) {
  if (!token.startsWith("mtl_")) return null;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  try {
    const identity = await authenticateKey(
      new Request(request.url, { headers }),
      env,
    );
    const props: GrantProps = { email: identity.email, keyId: identity.keyId };
    return { props, audience: resourceFor(env) };
  } catch (error) {
    if (error instanceof AppError && error.status === 403)
      throw new ExternalTokenError("insufficient_scope", {
        statusCode: 403,
        description: error.message,
      });
    if (error instanceof AppError && error.status === 401) return null;
    throw error;
  }
}

let cached: { origin: string; provider: OAuthProvider<Env> } | undefined;
/** The OAuth provider in front of the app, built once per origin. */
export function provider(env: Env, app: ExportedHandler<Env>) {
  if (cached?.origin !== env.APP_ORIGIN)
    cached = {
      origin: env.APP_ORIGIN,
      provider: new OAuthProvider<Env>({
        apiRoute: "/mcp",
        apiHandler: mcpHandler,
        defaultHandler: app,
        authorizeEndpoint: "/authorize",
        tokenEndpoint: "/oauth/token",
        clientRegistrationEndpoint: "/oauth/register",
        accessTokenTTL: ACCESS_TOKEN_TTL,
        refreshTokenTTL: REFRESH_TOKEN_TTL,
        refreshTokenIdleTTL: REFRESH_TOKEN_TTL,
        scopesSupported: [SCOPE],
        requiredScopes: [SCOPE],
        resourceMetadata: {
          resource: resourceFor(env),
          authorization_servers: [env.APP_ORIGIN],
          resource_name: "Mantel",
        },
        resolveExternalToken: resolveKey,
      }),
    };
  return cached.provider;
}
