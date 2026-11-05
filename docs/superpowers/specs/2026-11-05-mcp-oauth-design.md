# OAuth sign-in for Mantel's MCP server

Status: draft for the owner's approval, November 5, 2026.

## Intent

A teammate who already uses Mantel should be able to connect their AI client by adding Mantel's address and approving one screen, with no key to create, copy or paste. Today the MCP server at `/mcp` accepts only API keys from **Settings → API keys**, sent as a bearer header. That works in Claude Code, but clients that expect the standard MCP sign-in cannot connect at all. These include Claude's web and desktop custom connectors.

The MCP server itself already follows the protocol: the official SDK over Streamable HTTP, per-member tool lists and tool annotations. Only how clients get authorised changes.

## Goals

- **Standard sign-in:** `/mcp` supports the MCP authorization standard. That means OAuth 2.1 with PKCE, protected-resource metadata (RFC 9728), authorization-server metadata (RFC 8414) and dynamic client registration (RFC 7591).
- **Discovery:** an unauthenticated request to `/mcp` returns 401 with a `WWW-Authenticate` header that points to the resource metadata, so clients can discover how to sign in.
- **Sign-in and consent:** the person signs in with the Mantel account they already have, through the existing Google sign-in, then approves the client on a Mantel consent screen.
- **Same access as a session:** an OAuth token acts as that member with their current access. Permissions are re-read on every request, as for sessions and keys. A suspension or permission change therefore applies to connected apps immediately.
- **Revocation:** members can see their connected apps and disconnect them in Settings.
- **API keys keep working:** existing keys work on `/mcp` unchanged. That covers scripts, CI and the current Claude Code setup.

## Non-goals

- **No new permission model.** Owner decision: a connected app has exactly the member's own access level, with their level's permissions and any per-person adjustments, and nothing more or less. Any active member can connect, because connecting is not gated by a separate permission. There are no OAuth scopes beyond a single `mantel` scope.
- **No other sign-in providers.** Google remains the only one.
- **No browser API access.** OAuth tokens do not work on `/api/*`. As today, the browser API accepts only sessions.
- **No admin view.** Seeing or revoking other members' connected apps is out of scope.

## Anti-goals

These would make the work a failure even if it technically worked:

- **Anonymous MCP access:** it becomes possible to use the MCP without an active Mantel membership, or past a suspension.
- **Silent connections:** a client connects without the member seeing which app and which redirect address they are approving. That is the phishing path for open client registration.
- **Breaking existing keys:** existing API keys stop working, or the current Claude Code instructions break without a stated migration.
- **Hand-rolled OAuth:** token issuing, PKCE or registration are implemented from scratch when a maintained library exists.

## Constraints

- **Hosting:** the app is one Cloudflare Worker (`src/server/index.ts`) with D1, R2, Queues and Durable Objects. It has its own session cookie (`__Host-mantel_session`) and hashed API keys in D1.
- **Release checks:** the release verifier (`ci/verify-release.mjs`) must still pass. It needs anonymous `/mcp` to return 401, `/api/session` to return 401 or 302, and the Google start route to redirect.
- **Tests and CI:** follow the repo's PR workflow. All checks must pass before merging, and nothing merges without the owner's approval.
- **Secrets:** never put secrets in Git. Production configuration and D1 changes need the owner's approval.

## How it works

### Library (my call)

The design uses Cloudflare's `@cloudflare/workers-oauth-provider`. It is maintained, written for Workers and MCP, and provides the pieces below:

- metadata endpoints, dynamic client registration and the token endpoint;
- PKCE, refresh-token rotation and grant listing and revocation;
- consent helpers that bind the approval to the browser;
- a `resolveExternalToken` hook for accepting tokens it did not issue.

It stores grants and tokens, hashed, in a Workers KV namespace. That means a new `OAUTH_KV` binding, which is the one new Cloudflare resource.

The alternative was writing the OAuth server on D1 to match the existing tables. I rejected it under the hand-rolled OAuth anti-goal.

### Routing

The Worker's default export becomes an `OAuthProvider`:

- **API route:** `/mcp`, with the current MCP handler. The handler reads the member's email from the token's stored props and calls `loadIdentity`, so access is current on every request. It keeps the existing request-size limit.
- **External tokens:** the `resolveExternalToken` hook calls the existing `authenticateKey`, so `mtl_…` API keys work unchanged. It keeps their `keys.use` check and last-used tracking, and adds an explicit audience equal to the `/mcp` resource. Keys keep needing the `keys.use` permission. Its label changes from "API keys and MCP" to "API keys", because MCP access through OAuth no longer depends on it. (My call)
- **Endpoints:**
  - `/authorize` is the consent flow below;
  - `/oauth/token` issues and refreshes tokens;
  - `/oauth/register` registers clients, rate-limited by `AUTH_LIMITER`;
  - the `/.well-known/…` metadata documents are served by the provider. Today these paths fall through to the app's HTML page.
- **Everything else:** handled by today's code, unchanged, as the default handler.

### Consent flow

1. **`GET /authorize`:** the provider parses the client's request. If the browser has no valid Mantel session, the person is sent to Google sign-in and returned to the same `/authorize` request afterwards.
   - This needs a return-to path carried in the existing Google state cookie.
   - The path must be same-origin and begin with `/authorize`, with any other value ignored, so it cannot become an open redirect.
2. **Access check:** if the member is suspended, they see an explanation and the client receives `access_denied`. Any active member may continue, whatever their level. What the app can then do is limited by that level, for example to read-only demo access.
3. **Consent screen:** otherwise Mantel shows a server-rendered consent page in Mantel's styling. It names the client, the redirect address it will return to, and the account (email). It states that the app will be able to act as them with their current access. The buttons are **Allow** and **Cancel**.
4. **`POST /authorize`:** **Allow** finishes the authorization with props `{ email }` and user id = email. **Cancel** returns `access_denied` to the client. The library's consent handle and binding cookie tie the approval to this browser.

(My call) The member is asked again every time a client is registered. There is no "remember this app". Clients register once per install, so in practice the question comes once per app.

### Tokens

Owner decision: access tokens last 1 week. (My call) Refresh tokens rotate and expire after 30 days without use, matching the 30-day session length.

A week-long token is safe to allow because it carries no permissions of its own: every request re-reads the member's access, so suspension and level changes still apply at once. The remaining risk is a leaked token, which works for up to a week unless the member disconnects the app, which revokes it immediately.

Revocation and suspension apply to a token on its next request. The props hold only the email, and access is re-read from D1 each time.

### Settings

**Settings → API keys** gains a **Connected apps** list: client name, when it was connected and **Disconnect**. Disconnecting revokes the grant and its tokens. The list uses the library's grant listing for the signed-in member. Two browser API routes serve it: `GET` and `DELETE /api/settings/connected-apps`, session-only as with the other settings routes.

### Documentation

- **README:** the setup section leads with OAuth. In Claude Code that is `claude mcp add --transport http mantel https://YOUR_APP/mcp`, then sign in when prompted. Claude's web and desktop apps add the same URL as a custom connector. The API-key header remains as the option for scripts.
- **Architecture:** `docs/architecture.md` describes the new authorization paths.
- **Validation:** `docs/validation.md` records the production acceptance.

## Testing

- **Unit and integration tests**, in the existing Vitest setup with a KV binding:
  - the metadata and `WWW-Authenticate` responses;
  - registration;
  - consent requires a signed-in, active member. A member without `keys.use` can still connect, and their token is limited to their level's permissions;
  - Cancel returns `access_denied`;
  - a code-for-token exchange with PKCE;
  - an OAuth token works on `/mcp` and not on `/api/*`;
  - an OAuth token for a demo-level member can read the demo but cannot edit or build;
  - an issued access token expires after one week;
  - a suspended member's token is refused;
  - API keys still work;
  - disconnect revokes the token;
  - the Google return-to path rejects a foreign or non-`/authorize` path.
- **Release verifier:** extended to check that the metadata endpoints return JSON.
- **Production acceptance**, after deployment with the owner's approval: connect Claude Code through OAuth and list the tools, add the URL as a Claude custom connector, then disconnect in Settings and confirm the client loses access.

## Deployment

The `OAUTH_KV` namespace is created in Cloudflare and bound in `wrangler.jsonc`. Creating it in production needs the owner's approval, as does the first production deploy. No D1 migration is needed: grants live in KV, and connected apps are read from there.

## Left to the builder

- the consent page markup within Mantel's existing look;
- module layout, for example a new `src/server/oauth.ts`;
- exact error copy;
- how the KV namespace is created for local development and tests.
