# Accounts, access levels and API keys

Date: 2026-10-28. Status: approved. The first release is Google sign-in only; email and password follow once the owner has a domain for sending email.

## Intent

Deal Toy is moving from a private alpha (one approved Google account behind Cloudflare Access) to a product that anyone can sign up for. The owner decides what each person may do. Agents keep connecting through MCP, but people create their own keys instead of waiting for an administrator to run a script.

Why now: Cloudflare Access is a perimeter for a fixed list of people. It cannot offer self-service signup, and its free tier stops at a small number of seats. Moving sign-in into the app also removes the separate Access configuration that had to be kept in sync with the app.

## Goals

- In-app sign in and sign up with Google, replacing Cloudflare Access for browser traffic.
- Access levels the owner edits: named sets of permissions, one level per person, plus per-person Allow and Revoke adjustments.
- The lowest level (Demo) can only view a demo project and its build.
- Self-service API keys in Settings for MCP clients.
- A sign-in screen in the zero-interface style: the name "Deal Toy" as a 3D model the visitor can drag to spin, and one sign-in/sign-up card.

## Non-goals

- Project sharing between members (still owner-only, plus the demo). Planned next.
- Email-and-password accounts in this release (see Later).
- Organizations or teams, invitations by email, other identity providers, OAuth for MCP clients.
- Billing or paid plans.

## Anti-goals (would be a failure even if it works)

- Anyone can claim an existing member's account, especially the owner's, by signing up with that email.
- A new signup can spend compute. New accounts must not be able to run builds until someone grants it.
- A hidden button is the only thing stopping an action. Every permission is checked on the server, on every request, against current database state.
- Secrets in the repository, in logs, or stored in plain form in D1.

## Decisions

### Sign-in

**Continue with Google** is the only way in for this release. The owner decided this because email-and-password needs verification and reset emails, and those need a domain on Cloudflare, which Deal Toy does not have yet.

- The standard OAuth 2.0 authorization-code flow with PKCE, `state` and `nonce`, using a Google OAuth client the owner creates. The server exchanges the code with Google's token endpoint and validates the ID token: signature against Google's JWKS, issuer, audience, expiry and nonce.
- Only accounts whose Google email is verified are accepted.
- Members are linked by Google's stable subject id (`sub`). On first sign-in, a verified email that matches an existing member with no `sub` links to that member; this is how the owner's current account carries over. Otherwise a new member is created at the default level. A later sign-in with the same `sub` updates the stored email if Google's verified email changed.
- Sign in and sign up are the same flow. The card's two tabs only change the wording ("Sign in with Google" or "Create an account with Google") and the short explanation under it.

### Sessions

- On sign-in the server creates a random 32-byte session token and sets it as a cookie: `__Host-dt_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`. Only the SHA-256 hash is stored in D1 (`auth_sessions`).
- Sessions last 30 days, sliding. Sign-out deletes the session row. "Sign out everywhere" deletes all of the member's sessions.
- Every request reloads the member and their effective permissions. A suspended member's existing sessions stop working at once.
- State-changing requests that carry the cookie must have an `Origin` header that matches the app's own origin. The current check rejects a mismatched Origin; it will now also reject a missing one for cookie-authenticated writes.
- The live WebSocket ticket flow is unchanged and is issued from the cookie session.

### Abuse controls

- New accounts start at Demo, which cannot build or create projects, so open signup costs storage only.
- The Google start and callback endpoints are rate-limited per IP with the Workers rate-limiting binding.
- No Turnstile in this release. Google's own sign-in screens filter automated signups, and a new account costs nothing until it is promoted. Add Turnstile with email-and-password.
- A per-member daily build cap protects against a promoted account running away. It is set by a Worker variable and defaults to 100 builds a day.

### Permissions

Each permission is a stable key. The UI label goes in parentheses. "Owner" is not a permission: it is a flag that grants all of them.

| Key                                            | What it allows                                                                     | Enforced at                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------- |
| `demo.view` (View the demo)                    | Read the demo projects: model, revisions, build preview, activity, documents       | project read access                |
| `projects.create` (Create projects)            | `projects_create`                                                                  | tool                               |
| `models.edit` (Edit models)                    | `models_create`, `models_save`, `models_set_parameter`, `documents_add`            | tool                               |
| `builds.run` (Run builds)                      | `models_build`; `models_set_parameter` needs this too, because it builds           | tool                               |
| `exports.download` (Download exports)          | STEP, STL and report downloads. The GLB used by the viewer needs only read access. | artifact route                     |
| `notes.write` (Leave notes)                    | `notes_add`                                                                        | tool                               |
| `keys.use` (API keys and MCP)                  | Create keys, and use any key with `/mcp`                                           | key creation and every MCP request |
| `members.manage` (Manage members)              | Member list, levels, per-person adjustments, suspension                            | settings API                       |
| `settings.manage` (Configure skills and tools) | `skills_save`, `tools_configure`, and marking a project as a demo                  | tool and settings API              |

`settings.manage` is a ninth permission that the mockup did not show. It is the builder's call, so that today's administrator-only tools have a home.

Rules:

- Effective permissions = the level's permissions, plus individual Allows, minus individual Revokes. Revoke wins.
- Owners have every permission, whatever their level. Only an owner can make someone else an owner or remove ownership. At least one active owner must remain.
- Someone with `members.manage` who is not an owner cannot grant a permission they don't have, cannot edit a member whose effective permissions are not a subset of their own, and cannot change their own access.
- Levels are rows that can be edited. Seeded levels: **Demo** (default for new accounts: `demo.view`), **Maker** (every permission except `members.manage` and `settings.manage`) and **Admin** (all). One level is marked default. A level that still has members cannot be deleted.
- Membership and level changes are written to an `audit_events` table: actor, target, change and time. There is no UI for the log in this increment.

### Projects and the demo

- Project access stays owner-only for everything that writes.
- A project can be flagged `demo` by someone with `settings.manage`. A member with `demo.view` can read any demo project: `projects_list` (demo projects listed separately), `projects_get`, `projects_activity`, `builds_get`, the GLB preview, and the live socket. They cannot write to it, start sessions on it or leave notes on it, even if they hold the write permissions for their own projects.
- Someone at the Demo level opens straight into the demo workspace. The chat panel shows the demo's history read-only, and the composer is replaced by a short line saying what their access allows.

### API keys

- A key is `dtk_` followed by 32 random bytes in base64url. It is shown once. D1 stores its SHA-256 hash, a display prefix (the first 8 characters), a name, the creation time, the expiry (30, 90 or 365 days, default 90), the time it was last used and when it was revoked.
- Each member can have at most 10 active keys. Revoking a key takes effect on the next request.
- Keys are accepted only on `/mcp`. The browser API accepts only the session cookie. This shrinks what a leaked key can reach.
- Each MCP request with a key checks that the key is valid and not revoked, the member is active, and the member has `keys.use`. The tool's own permission is checked next. Losing `keys.use` disables every key the member has without deleting them.
- `last_used_at` is written at most once every 5 minutes per key.
- "Copy Claude Code command" produces `claude mcp add --transport http deal-toy <origin>/mcp --header "Authorization: Bearer <key>"`. The page says the key then lives in the client's config.
- Migration: existing rows in `tokens` become keys named after their label, with the prefix "legacy". `ci/member.mjs` becomes an owner recovery tool: it creates a member and one key from the command line for bootstrap or recovery.

### Data model (new migration `0003_accounts.sql`)

- `members`: add `name`, `picture` (Google avatar URL, optional), `level_id`, `owner` (0/1), `status` (`active`|`suspended`), `google_sub` (unique), `created_at`, `last_active_at`. Remove the `role` and `active` columns, or retire them once their data is migrated:
  - `role='admin'` becomes `owner=1` at the Admin level.
  - `role='maker'` becomes the Maker level.
  - `active=0` becomes `status='suspended'`.

  No email address appears in the migration.

- `levels` (`id`, `name`, `is_default`, `created_at`) and `level_permissions` (`level_id`, `permission`).
- `member_permissions` (`email`, `permission`, `effect` `allow`|`revoke`).
- `auth_sessions` (`hash`, `email`, `created_at`, `expires_at`, `last_seen_at`, `user_agent` truncated).
- `api_keys` (`id`, `email`, `name`, `prefix`, `hash` unique, `created_at`, `expires_at`, `last_used_at`, `revoked_at`).
- `oauth_states` for the short-lived Google `state`, PKCE verifier and nonce, valid for 10 minutes and single use. Alternatively these can go in a signed, HttpOnly cookie, which is the builder's choice.
- `audit_events`.
- `projects`: add `demo` (0/1).
- `tokens` is dropped after its rows move into `api_keys`.

### Server shape

- `Identity` becomes `{ email, name, owner, permissions: Set<Permission> }`. The `admin(c)` helper is replaced by `require(c, permission)`. Each tool declares the permission it needs, and `dispatch` checks it alongside the enablement check.
- `projectAccess` gains a read variant that also admits demo projects for members with `demo.view`. Writes keep the owner check.
- New routes under `/api/auth/*`: Google start, Google callback, and sign out. They are public apart from rate limits.
- New routes under `/api/settings/*`: the account, keys, members, levels and audit write paths. These are HTTP JSON routes, not MCP tools: people manage accounts, agents don't.
- The Cloudflare Access verification code and its `ACCESS_*` variables are removed. `/health` stays public.

### Interface

- Sign-in screen as in `docs/design/2026-10-28-accounts-mockup.html` and its screenshots:
  - The canvas fills the screen and shows a draggable 3D name. It turns slowly when idle, with zoom and pan off.
  - One card switches between sign in and sign up, with the Google button and one line explaining what a new account starts with. The mockup's email and password fields are left out of this release.
  - On phones the card docks at the bottom. Light and dark themes are supported.
  - Raise the name's contrast compared with the mockup.
- The name model is a real Deal Toy output:
  - `examples/brand/name.py` (build123d) builds "Deal Toy" and the diamond mark, and its GLB is committed as a static asset.
  - The font file is checked in with its license; Inter (OFL) is the suggestion.
  - If the CAD runtime cannot render text from a bundled font, the builder may fall back to an outline traced at build time, and should say so.
- Settings page with the sections Account, API keys, Members and Access levels, as in the mockup:
  - **Account:** name, email (from Google), and sign out everywhere.
  - **Members:** list, search, level, the per-person Level/Allow/Revoke editor, and suspend.
  - **Access levels:** the permission grid, a new level, rename, delete, and set default.
- Sections are hidden when the member lacks the permission. The server enforces them regardless.
- The existing Connect drawer points to Settings → API keys instead of "administrator-issued token".
- three.js already ships in the workspace bundle. The sign-in page lazy-loads the same viewer code so the first paint is the card.

### Deployment order

1. Merge and deploy with the new auth. Access still covers the browser, so for the moment only the owner gets through to the new sign-in page. The owner signs in with Google. Their existing member row links because the verified email matches, and they become owner through the migration.
2. Verify in production:
   - the owner signs in;
   - a second account signs up and lands on Demo;
   - the owner promotes it and the change takes effect;
   - a key is created and used from Claude Code, then revoked;
   - a suspended member's session dies.
3. With the owner's approval, delete the two Cloudflare Access applications ("Deal Toy" and "Deal Toy machine endpoints"). Update `docs/deployment.md`.

### Testing

Worker tests, in the existing vitest-pool-workers suite:

- Google callback with Google's token endpoint and JWKS mocked: state and PKCE, ID-token signature, issuer, audience, expiry and nonce, the verified-email requirement, linking an existing member by email exactly once, and later linking by `sub`.
- Session expiry, sign-out, sign out everywhere, and suspension.
- Origin required for cookie writes.
- The permission grid:
  - each tool and route is denied without its permission and allowed with it;
  - revoke wins;
  - the owner bypass;
  - delegated-admin limits;
  - the last owner can't be removed.
- Demo read-only access, including through the live socket.
- Keys: once-only display, hash at rest, expiry, revocation, the 10-key limit, `keys.use` loss disabling keys, and a key refused on `/api`.
- Rate limits.
- The migration moves existing members and tokens correctly.

The browser is checked with Chrome DevTools in light and dark at 1440 px and 390 px: dragging the name, the sign-up/sign-in switch, the settings sections, and the Demo-level workspace.

## Left to the builder

The exact component structure, the error copy, the `oauth_states` storage choice, the PBKDF2 iteration count (as high as Workers allows), rate-limit numbers, how the demo project is chosen in the UI (a toggle in the project's ⋯ menu is suggested), and the name model's font and proportions.

## Setup the owner does

1. Create a Google OAuth client (type: web application) with the authorized redirect URI `https://unitedai-deal-toy.ivan27chen.workers.dev/api/auth/google/callback`, plus `http://localhost:8787/api/auth/google/callback` for local development. Store the client ID as a Worker variable and the secret with `wrangler secret put GOOGLE_CLIENT_SECRET`. Never put the secret in Git.

## Later

- Email-and-password accounts, once a domain is on Cloudflare for Email Sending:
  - PBKDF2-SHA256 with a versioned hash format and the highest iteration count Workers supports;
  - verification and reset emails;
  - Turnstile on signup.

  An email-and-password signup for an email that already exists must be refused, never linked.

- Project sharing with roles, OAuth for MCP clients, and a UI for the audit log.
