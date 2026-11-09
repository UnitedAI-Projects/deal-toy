import {
  getOAuthApi,
  GrantType,
  OAuthProvider,
  type GrantSummary,
  type OAuthHelpers,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { loadIdentity } from "./access";
import { AppError, boundedText, failure, hash, secure } from "./core";
import { mcp } from "./mcp";

/** Access tokens last a week; every request still re-reads the member's current access. */
export const ACCESS_TOKEN_TTL = 7 * 86400;
/** Refresh tokens rotate and lapse after 30 days unused, matching browser sessions. */
export const REFRESH_TOKEN_TTL = 30 * 86400;
/** The single scope: a connected app acts as the member, with exactly their access. */
export const SCOPE = "mantel";
/**
 * The grant's user id. The library puts it in plain text at the front of every code and token,
 * so it is a digest of the email rather than the email itself, which would otherwise appear in
 * redirect URLs, browser history and client logs.
 */
export async function grantUser(email: string) {
  return (await hash(`mantel-oauth-user:${email}`)).slice(0, 32);
}
/** What a grant carries to the /mcp handler. */
export type GrantProps = { email: string };

const resourceFor = (env: Env) => `${env.APP_ORIGIN}/mcp`;

/** Serves /mcp to a member signed in through OAuth. */
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

/** Every grant (approved app) the user id has, across pages. */
export async function listGrants(helpers: OAuthHelpers, userId: string) {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(userId, { cursor });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
}
export const appName = (grant: { metadata?: unknown } | null | undefined) => {
  const name = (grant?.metadata as { clientName?: unknown } | undefined)
    ?.clientName;
  return typeof name === "string" ? name : "Unnamed app";
};

/** Records a connected-app event in the audit log and the Worker log. */
export async function recordApp(
  env: Env,
  email: string,
  action: "app.connect" | "app.disconnect" | "app.signout",
  detail: { app: string; grant: string; replaced?: number },
) {
  console.log(JSON.stringify({ event: action, ...detail }));
  // A failed audit write is logged; it never blocks signing in or out.
  await env.DB.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?,?)")
    .bind(
      crypto.randomUUID(),
      email,
      email,
      action,
      JSON.stringify(detail),
      new Date().toISOString(),
    )
    .run()
    .catch(() =>
      console.error(JSON.stringify({ event: "audit_failed", action })),
    );
}

/**
 * Runs when an app finishes signing in (swaps its code for passes). Only now are the app's older
 * sign-ins replaced, so an approval that never reaches the app leaves the working one alone.
 */
async function finishConnect(
  helpers: OAuthHelpers,
  env: Env,
  done: {
    userId: string;
    grantId: string;
    clientId: string;
    props: GrantProps;
  },
) {
  const grants = await listGrants(helpers, done.userId);
  const older = grants.filter(
    (g) => g.clientId === done.clientId && g.id !== done.grantId,
  );
  // A leftover older sign-in is harmless; failing to remove one must not fail this sign-in.
  await Promise.allSettled(
    older.map((g) => helpers.revokeGrant(g.id, done.userId)),
  );
  await recordApp(env, done.props.email, "app.connect", {
    app: appName(grants.find((g) => g.id === done.grantId)),
    grant: done.grantId,
    replaced: older.length,
  });
}

function options(env: Env, app: ExportedHandler<Env>) {
  const config: OAuthProviderOptions<Env> = {
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
    async tokenExchangeCallback(exchange) {
      if (exchange.grantType === GrantType.AUTHORIZATION_CODE)
        await finishConnect(getOAuthApi(config, exchange.env), exchange.env, {
          userId: exchange.userId,
          grantId: exchange.grantId,
          clientId: exchange.clientId,
          props: exchange.props as GrantProps,
        });
    },
  };
  return config;
}

let cached: { origin: string; provider: OAuthProvider<Env> } | undefined;
/** The OAuth provider in front of the app, built once per origin. */
export function provider(env: Env, app: ExportedHandler<Env>) {
  if (cached?.origin !== env.APP_ORIGIN)
    cached = {
      origin: env.APP_ORIGIN,
      provider: new OAuthProvider<Env>(options(env, app)),
    };
  return cached.provider;
}

/**
 * Serves a request through the provider. An app signing itself out (token revocation, which
 * ends its whole grant) is recorded in the audit log, since the library has no hook for it.
 */
export async function serve(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  app: ExportedHandler<Env>,
) {
  const url = new URL(request.url);
  let revoking: {
    key: string;
    grant: string;
    email?: string;
    app: string;
  } | null = null;
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    const body = new URLSearchParams(await request.clone().text());
    const [userId, grantId] = (body.get("token") ?? "").split(":");
    if (
      !body.get("grant_type") &&
      /^[A-Za-z0-9_-]{1,128}$/.test(userId ?? "") &&
      /^[A-Za-z0-9_-]{1,128}$/.test(grantId ?? "")
    ) {
      const key = `grant:${userId}:${grantId}`;
      const grant = await env.OAUTH_KV.get<{
        metadata?: { email?: unknown };
      }>(key, { type: "json" });
      if (grant)
        revoking = {
          key,
          grant: grantId,
          app: appName(grant),
          email:
            typeof grant.metadata?.email === "string"
              ? grant.metadata.email
              : undefined,
        };
    }
  }
  const response = await provider(env, app).fetch(request, env, ctx);
  if (revoking?.email && response.ok && !(await env.OAUTH_KV.get(revoking.key)))
    await recordApp(env, revoking.email, "app.signout", {
      app: revoking.app,
      grant: revoking.grant,
    });
  return response;
}
