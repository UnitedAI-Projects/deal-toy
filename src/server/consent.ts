import {
  AuthorizationError,
  type ConsentDescription,
} from "@cloudflare/workers-oauth-provider";
import { authenticateBrowser } from "./auth";
import { AppError, boundedText, type Identity } from "./core";
import { SCOPE } from "./oauth";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** A complete, script-free page in Mantel's light/dark palette. Every argument is escaped. */
function page(
  status: number,
  title: string,
  body: string,
  headers?: Headers,
): Response {
  const out = new Headers(headers);
  out.set("Content-Type", "text/html; charset=utf-8");
  out.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  out.set("X-Frame-Options", "DENY");
  out.set("X-Content-Type-Options", "nosniff");
  out.set("Referrer-Policy", "no-referrer");
  out.set("Cache-Control", "private, no-store");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Mantel</title><style>
:root{color-scheme:light dark;--bg:#f6f6f4;--surface:#fff;--ink:#1b1c20;--muted:#676b74;--line:#e3e3df;--primary:#1b1c20;--on-primary:#fff;--bad:#d93a32}
@media (prefers-color-scheme:dark){:root{--bg:#111214;--surface:#1a1b1f;--ink:#ecedf0;--muted:#9a9fa9;--line:#2b2d33;--primary:#ecedf0;--on-primary:#111214}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{box-sizing:border-box;width:min(440px,calc(100vw - 32px));background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:20px;line-height:1.3;margin:0 0 16px;overflow-wrap:anywhere}p{margin:0 0 10px;color:var(--muted);overflow-wrap:anywhere}strong{color:var(--ink)}
.actions{display:flex;gap:10px;margin-top:22px}button{flex:1;font:inherit;font-weight:600;padding:10px 14px;border-radius:9px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
button[value=allow]{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers: out },
  );
}
const message = (status: number, title: string, text: string) =>
  page(status, title, `<h1>${escape(title)}</h1><p>${escape(text)}</p>`);
const expired = () =>
  message(
    400,
    "Approval expired",
    "This approval expired or was already used. Start connecting again from your app.",
  );
const signIn = (next: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `/api/auth/google/start?next=${encodeURIComponent(next)}`,
      "Cache-Control": "private, no-store",
    },
  });

/** The signed-in member, null when there is no valid session, or "suspended". */
async function viewer(
  request: Request,
  env: Env,
): Promise<Identity | null | "suspended"> {
  try {
    return await authenticateBrowser(request, env);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return null;
    if (error instanceof AppError && error.status === 403) return "suspended";
    throw error;
  }
}
const suspended = () =>
  message(
    403,
    "Account suspended",
    "Your Mantel account is suspended, so you cannot connect apps. Ask an admin.",
  );

function consentPage(
  description: ConsentDescription,
  email: string,
  handle: string,
  returnTo: string,
  headers: Headers,
) {
  const name = escape(description.clientName);
  const host = escape(description.redirectHost);
  return page(
    200,
    `Connect ${description.clientName} to Mantel`,
    `<h1>Connect <strong>${name}</strong> to Mantel</h1>
<p>It will return to <strong>${host}</strong>${description.redirectIsLoopback ? " (an app on this computer)" : ""}.</p>
<p>Signed in as <strong>${escape(email)}</strong>.</p>
<p>It will be able to use Mantel as you, with your current access level.</p>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escape(handle)}">
<input type="hidden" name="return_to" value="${escape(returnTo)}">
<input type="hidden" name="account" value="${escape(email)}">
<div class="actions"><button type="submit" name="action" value="cancel">Cancel</button><button type="submit" name="action" value="allow">Allow</button></div>
</form>`,
    headers,
  );
}

/**
 * The OAuth consent screen at /authorize. A member signs in with Google if needed, sees which
 * app and redirect address they are approving, and chooses Allow or Cancel. The library's
 * consent handle and binding cookie tie the approval to this browser, once.
 */
export async function authorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const helpers = env.OAUTH_PROVIDER;
  if (request.method === "GET") {
    let authRequest;
    try {
      authRequest = await helpers.parseAuthRequest(request);
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo)
        return Response.redirect(error.redirectTo, 302);
      return message(
        400,
        "Cannot connect",
        error instanceof AuthorizationError
          ? error.description
          : "This connection request is not valid. Start connecting again from your app.",
      );
    }
    const member = await viewer(request, env);
    if (member === "suspended") return suspended();
    if (!member) return signIn(url.pathname + url.search);
    const description = await helpers.describeConsent(authRequest);
    const { handle, headers } = await helpers.beginConsent(authRequest);
    return consentPage(
      description,
      member.email,
      handle,
      url.pathname + url.search,
      headers,
    );
  }
  if (request.method !== "POST")
    return message(405, "Not allowed", "Use the consent form.");
  // The binding cookie already ties the handle to this browser; refuse other sites outright too.
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin)
    return message(403, "Not allowed", "Cross-origin requests are not allowed");
  const form = new URLSearchParams(await boundedText(request, 8000));
  const handle = form.get("handle") ?? "";
  const returnTo = form.get("return_to") ?? "";
  const member = await viewer(request, env);
  if (member === "suspended") return suspended();
  // The session may have ended while the page was open: sign in again, then re-ask.
  if (!member)
    return returnTo.startsWith("/authorize?")
      ? signIn(returnTo)
      : message(401, "Signed out", "Sign in to Mantel and connect again.");
  // Approve only for the account the page named, not one signed in since in another tab.
  if (form.get("account") !== member.email) return expired();
  try {
    if (form.get("action") === "allow") {
      const approved = await helpers.approveConsent(request, handle, {
        scope: [SCOPE],
      });
      const description = await helpers.describeConsent(approved.request);
      const { redirectTo } = await helpers.completeAuthorization({
        request: approved.request,
        userId: member.email,
        scope: [SCOPE],
        props: { email: member.email },
        metadata: { clientName: description.clientName },
      });
      const headers = new Headers(approved.headers);
      headers.set("Location", redirectTo);
      headers.set("Cache-Control", "private, no-store");
      return new Response(null, { status: 302, headers });
    }
    const denied = await helpers.denyConsent(request, handle);
    const headers = new Headers(denied.headers);
    headers.set("Location", denied.redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return expired();
    throw error;
  }
}
