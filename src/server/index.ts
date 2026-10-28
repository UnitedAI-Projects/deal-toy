import { z } from "zod";
import {
  authenticateBrowser,
  authenticateKey,
  readCookie,
  redeemLink,
  SESSION_COOKIE,
  signOut,
} from "./auth";
import { AppError, boundedText, projectAccess, revisionAccess } from "./core";
import { consume } from "./builds";
import { googleCallback, googleStart } from "./google";
import { catalog, dispatch } from "./tools";
import { mcp } from "./mcp";
export { CadContainer } from "./builds";
export { ProjectLive } from "./live";
function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health")
        return Response.json({ status: "ok", release: env.RELEASE_SHA });
      if (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp") {
        const response = await env.ASSETS.fetch(request);
        const headers = new Headers(response.headers);
        headers.set(
          "Content-Security-Policy",
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://${url.host} ws://${url.host}; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
        );
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      const origin = request.headers.get("Origin");
      // A cookie-authenticated write must prove it comes from this app's own pages.
      const cookieWrite =
        url.pathname.startsWith("/api/") &&
        !["GET", "HEAD"].includes(request.method) &&
        readCookie(request, SESSION_COOKIE) !== undefined;
      if ((origin && origin !== url.origin) || (cookieWrite && !origin))
        throw new AppError(403, "Cross-origin requests are not allowed");
      // Browsers cannot send bearer headers on a WebSocket. The socket presents a single-use
      // ticket issued below over the authenticated API; the project's relay checks it.
      const liveMatch = /^\/api\/projects\/([a-f0-9-]{36})\/live$/.exec(
        url.pathname,
      );
      if (liveMatch && request.headers.get("Upgrade") === "websocket") {
        // Malformed tickets never reach (or wake) the project's relay.
        const ticket = url.searchParams.get("ticket") ?? "";
        if (!/^[0-9a-f-]{72}$/.test(ticket))
          throw new AppError(401, "Ticket expired; request a new one");
        return env.LIVE.getByName(liveMatch[1]).fetch(request);
      }
      const userAgent = request.headers.get("User-Agent") ?? "";
      if (url.pathname === "/api/auth/google/start" && request.method === "GET")
        return secure(await googleStart(request, env));
      if (
        url.pathname === "/api/auth/google/callback" &&
        request.method === "GET"
      )
        return secure(await googleCallback(request, env));
      // Sign-in links open the app at /link#token; the page redeems the token with a
      // same-origin POST, so another site cannot sign a browser into someone else's account.
      if (url.pathname === "/api/auth/link" && request.method === "POST") {
        if (origin !== url.origin)
          throw new AppError(403, "Cross-origin requests are not allowed");
        const { token } = z
          .object({ token: z.string().max(100) })
          .strict()
          .parse(JSON.parse((await boundedText(request, 1000)) || "{}"));
        const set = await redeemLink(env, token, userAgent).catch(() => null);
        if (!set)
          throw new AppError(
            401,
            "This sign-in link has expired or was already used",
          );
        return secure(
          Response.json({ ok: true }, { headers: { "Set-Cookie": set } }),
        );
      }
      if (url.pathname === "/api/auth/signout" && request.method === "POST") {
        const body = z
          .object({ everywhere: z.boolean().default(false) })
          .strict()
          .parse(JSON.parse((await boundedText(request, 1000)) || "{}"));
        return secure(
          Response.json(
            { ok: true },
            {
              headers: {
                "Set-Cookie": await signOut(request, env, body.everywhere),
              },
            },
          ),
        );
      }
      // API keys are accepted only by the MCP endpoint; the browser API takes only sessions.
      const identity =
        url.pathname === "/mcp"
          ? await authenticateKey(request, env)
          : await authenticateBrowser(request, env);
      const c = { env, identity };
      const ticketMatch =
        /^\/api\/projects\/([a-f0-9-]{36})\/live-ticket$/.exec(url.pathname);
      if (ticketMatch && request.method === "POST") {
        await projectAccess(c, ticketMatch[1]);
        const ticket = await env.LIVE.getByName(ticketMatch[1]).issueTicket(
          identity.email,
        );
        return secure(Response.json({ ticket }));
      }
      if (url.pathname === "/mcp") {
        let mcpRequest: Request = request;
        if (request.method === "POST") {
          const body = await boundedText(request);
          mcpRequest = new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body,
          });
        }
        return secure(await mcp(mcpRequest, c));
      }
      if (url.pathname === "/api/session" && request.method === "GET")
        return secure(
          Response.json({
            email: identity.email,
            name: identity.name,
            owner: identity.owner,
            permissions: [...identity.permissions],
          }),
        );
      if (url.pathname === "/api/tools" && request.method === "GET")
        return secure(Response.json(await catalog(c)));
      const artifactMatch = /^\/api\/artifacts\/([a-f0-9-]+)$/.exec(
        url.pathname,
      );
      if (artifactMatch && request.method === "GET") {
        const artifact = await env.DB.prepare(
          "SELECT artifacts.*,jobs.revision_id FROM artifacts JOIN jobs ON jobs.id=artifacts.job_id WHERE artifacts.id=?",
        )
          .bind(artifactMatch[1])
          .first<{
            name: string;
            object_key: string;
            media_type: string;
            revision_id: string;
          }>();
        if (!artifact) throw new AppError(404, "Artifact not found");
        await revisionAccess(c, artifact.revision_id);
        const object = await env.ARTIFACTS.get(artifact.object_key);
        if (!object) throw new AppError(404, "Artifact missing");
        return secure(
          new Response(object.body, {
            headers: {
              "Content-Type": artifact.media_type,
              "Content-Disposition": `attachment; filename="${artifact.name}"`,
            },
          }),
        );
      }
      const toolMatch = /^\/api\/tools\/([a-z_]+)$/.exec(url.pathname);
      if (toolMatch && request.method === "POST") {
        if (
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          throw new AppError(415, "Use application/json");
        let input: unknown;
        try {
          input = JSON.parse(await boundedText(request));
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(400, "Invalid JSON");
        }
        return secure(
          Response.json((await dispatch(c, toolMatch[1], input, "http")).value),
        );
      }
      throw new AppError(404, "Route not found");
    } catch (error) {
      const status =
        error instanceof AppError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 500;
      if (status === 500)
        console.error(
          JSON.stringify({ event: "request_failed", path: url.pathname }),
        );
      return secure(
        Response.json(
          {
            error:
              status === 500
                ? "Request failed"
                : error instanceof Error
                  ? error.message
                  : "Invalid request",
          },
          { status },
        ),
      );
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) await consume(message, env);
  },
  async scheduled(_event, env) {
    await env.DB.prepare(
      "UPDATE jobs SET status='failed',error='Build timed out or delivery was interrupted; submit a new build',updated_at=? WHERE status IN ('queued','running') AND updated_at<?",
    )
      .bind(
        new Date().toISOString(),
        new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      )
      .run();
  },
} satisfies ExportedHandler<Env>;
