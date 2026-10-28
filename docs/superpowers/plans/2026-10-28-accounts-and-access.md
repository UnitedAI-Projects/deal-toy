# Accounts, access levels and API keys: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline in the main session (the owner asked for no subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cloudflare Access with in-app Google sign-in. Add owner-managed access levels with per-person adjustments, a read-only demo for the lowest level, and self-service API keys for MCP.

**Architecture:**

- A browser session cookie authenticates `/api/*`, and API keys authenticate only `/mcp`.
- Every request loads the member's current effective permission set from D1: the level, plus Allows, minus Revokes, with owners getting everything.
- Each tool and route declares the one permission it needs. Project writes stay owner-only. Projects flagged `demo` are readable by anyone with `demo.view`.

**Tech stack:** Cloudflare Workers (TypeScript), D1, the Workers rate-limiting binding, jose for Google ID tokens, React 19 and Three.js r186, build123d for the name model, Vitest with `@cloudflare/vitest-plugin`.

**Spec:** `docs/superpowers/specs/2026-10-28-accounts-and-access-design.md`

## Global constraints

- Google is the only sign-in method. No password, email-token or Turnstile code.
- Cookie: `__Host-dt_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`. It holds 32 random bytes in base64url. D1 stores only the SHA-256 hash. Sessions last 30 days, sliding.
- API key format: `dtk_` plus 32 random bytes in base64url. D1 stores only the SHA-256 hash and an 8-character display prefix. Expiry is 30, 90 or 365 days, default 90. A member can have at most 10 active keys. `last_used_at` is written at most once every 5 minutes. Keys are accepted only on `/mcp`.
- Permission keys, exactly: `demo.view`, `projects.create`, `models.edit`, `builds.run`, `exports.download`, `notes.write`, `keys.use`, `members.manage`, `settings.manage`.
- Seeded levels:
  - Demo: default, with `demo.view`.
  - Maker: every permission except `members.manage` and `settings.manage`.
  - Admin: all permissions.
- Revoke wins. Owners have every permission. At least one active owner must remain.
- The daily build cap per member comes from the `DAILY_BUILD_LIMIT` variable, default `100`.
- Every cookie-authenticated write needs an `Origin` header equal to the app origin. A missing Origin is refused.
- No email address goes into migrations or Git. Secrets go only into Worker secrets.
- Follow the existing style: small modules, `AppError(status, message)`, zod at the edges, and tests in `src/server/*.test.ts`.
- Commit as `ichen27 <ivan27chen@gmail.com>`, with no AI attribution anywhere.

## Review focus

1. **Owner takeover through Google linking.** A Google account whose verified email matches an existing member links only if that member has no `google_sub` yet. A second Google account using the same email must not take over a member who is already linked. Test: `refuses a second Google subject for an already linked email` (Task 3).
2. **Stale access after a change.** A session or key that is already open must lose access on the next request once the member is suspended or loses a permission. Tests: `suspension ends existing sessions and keys` (Task 2) and `losing keys.use disables every key` (Task 5).
3. **Demo viewers writing through a side door.** Notes, sessions, parameter edits, live tickets and downloads on a demo project the viewer doesn't own. Test: `demo viewer cannot write to the demo through any tool` (Task 4).
4. **Delegated-admin escalation.** A non-owner with `members.manage` grants themselves or others permissions they lack, edits someone with more access, or removes the last owner. Test: `delegated admin limits` (Task 6).
5. **Login CSRF and forged callbacks.**
   - A callback with a missing or wrong `state`, a reused `state` or a mismatched nonce.
   - An ID token for another audience.
   - A cookie write with no Origin.

   Tests: `rejects forged Google callbacks` (Task 3) and `cookie writes require same-origin Origin` (Task 2).

---

## File structure

| File                                | Responsibility                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `migrations/0003_accounts.sql`      | New tables, member migration, token→key migration, `projects.demo`, `jobs.created_by`                                 |
| `src/server/access.ts`              | Permission list, effective permissions, `loadIdentity`, `require`                                                     |
| `src/server/auth.ts` (rewrite)      | Session cookies, sign-in links, key authentication, `authenticate`                                                    |
| `src/server/google.ts`              | Google OAuth start and callback, ID-token verification, member linking                                                |
| `src/server/settings.ts`            | HTTP handlers for the account, keys, members, levels and the demo flag                                                |
| `src/server/core.ts`                | `Identity`, `projectAccess(c, id, mode)`, and the model and revision helpers with the same mode; `admin()` is removed |
| `src/server/tools.ts`               | A `permission` on each tool, demo-aware reads, the build cap, explicit insert columns                                 |
| `src/server/index.ts`               | Routes, auth split between `/api` and `/mcp`, Access code removed                                                     |
| `src/server/test-helpers.ts`        | `member(email, opts)` seeds a member and returns a `Context`; `cookieFor(email)`                                      |
| `ci/member.mjs` (rewrite)           | Operator bootstrap and recovery: creates a member and prints a one-time sign-in link                                  |
| `ci/verify-release.mjs`             | Expects 401 from `/api/session` and `/mcp`                                                                            |
| `examples/brand/name.py`, `fonts/`  | build123d source for the name model and the bundled OFL font                                                          |
| `public/brand/deal-toy-name.glb`    | Committed name model                                                                                                  |
| `src/web/api.ts`                    | Cookie-based requests (bearer and sessionStorage removed), new types                                                  |
| `src/web/SignIn.tsx`                | Sign-in card                                                                                                          |
| `src/web/NameStage.tsx`             | Draggable 3D name on the full-bleed canvas                                                                            |
| `src/web/Settings.tsx`              | Account, API keys, Members and Access levels                                                                          |
| `src/web/main.tsx`, `Workspace.tsx` | Routing, permission-aware controls, read-only demo workspace                                                          |
| `docs/*`, `README.md`               | Updated auth, setup and deployment docs                                                                               |

---

### Task 1: Accounts schema and permission model

**Files:**

- Create: `migrations/0003_accounts.sql`, `src/server/access.ts`, `src/server/access.test.ts`, `src/server/test-helpers.ts`
- Modify: `src/server/core.ts` (the `Identity` type)

**Interfaces:**

- Produces:
  - `PERMISSIONS: readonly Permission[]` (the 9 keys in Global constraints order)
  - `type Permission`
  - `type Identity = { email: string; name: string; owner: boolean; permissions: Set<Permission> }`
  - `loadIdentity(env, email): Promise<Identity>`, which throws `AppError(403,"Account suspended")` for suspended members and `AppError(401,"Sign in")` for unknown ones
  - `require(c: Context, p: Permission): void`, which throws `AppError(403, "You need the “<label>” permission")`
  - `PERMISSION_LABELS: Record<Permission,string>`
  - Test helper `member(email, { owner?, level?: "Demo"|"Maker"|"Admin", allow?, revoke?, status? }): Promise<Context>`

Schema (`0003_accounts.sql`):

- `levels(id TEXT PK, name TEXT NOT NULL UNIQUE, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`
- `level_permissions(level_id REFERENCES levels ON DELETE CASCADE, permission TEXT NOT NULL, PK(level_id, permission))`
- `members`: add `name TEXT NOT NULL DEFAULT ''`, `level_id TEXT REFERENCES levels(id)`, `owner INTEGER NOT NULL DEFAULT 0`, `status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended'))`, `google_sub TEXT` (unique index), `created_at TEXT`, `last_active_at TEXT`. Migrate the data:
  - `owner = role='admin'`
  - `level_id` = the Admin level for admins and the Maker level for makers
  - `status = CASE active WHEN 1 THEN 'active' ELSE 'suspended' END`

  Then drop `role` and `active`.

- `member_permissions(email REFERENCES members, permission, effect CHECK IN ('allow','revoke'), PK(email, permission))`
- `auth_sessions(hash PK, email REFERENCES members, created_at, expires_at, last_seen_at, user_agent)`
- `signin_links(hash PK, email REFERENCES members, expires_at, used_at)`
- `api_keys(id PK, email REFERENCES members, name, prefix, hash UNIQUE, created_at, expires_at, last_used_at, revoked_at)`. Insert one row per `tokens` row: `name = label`, `prefix='legacy'`, `created_at = now`. Then drop `tokens`.
- `audit_events(id PK, actor, target, action, detail TEXT JSON, created_at)`
- `projects`: add `demo INTEGER NOT NULL DEFAULT 0`. `jobs`: add `created_by TEXT`.
- Fixed level ids: `level-demo`, `level-maker`, `level-admin`.

- [ ] **Step 1: Write failing tests in `access.test.ts`.**
  - `migrates admins to owners and makers to the Maker level`: apply 0001–0002, insert `('a@x','admin',1)`, `('m@x','maker',1)` and `('s@x','maker',0)` and a token row, then apply 0003.
    - Expect `a@x` to have owner=1 and `level-admin`.
    - Expect `m@x` at `level-maker` with status active, and `s@x` suspended.
    - Expect one `api_keys` row with prefix `legacy` and the same hash.
  - `effective permissions are level plus allow minus revoke`: a Maker with `revoke: ["builds.run"]` and `allow: ["members.manage"]` has `members.manage` and lacks `builds.run`.
  - `owners have every permission regardless of level or revokes`.
  - `suspended members cannot load an identity`: expects 403.
- [ ] **Step 2: Run `npx vitest run src/server/access.test.ts`.** Expected: FAIL (no module or migration).
- [ ] **Step 3: Write the migration, `access.ts`, `test-helpers.ts` and the `Identity` type in `core.ts`.** Compute permissions in one query: the level's permissions union the allows, except the revokes.
- [ ] **Step 4: Rerun the test.** Expected: PASS. Other suites will fail until Task 4; that is expected, so don't run them yet.
- [ ] **Step 5: Commit** with "Add accounts schema and permission model".

### Task 2: Sessions, sign-in links and authentication split

**Files:**

- Rewrite: `src/server/auth.ts`, `src/server/auth.test.ts`
- Modify: `src/server/index.ts` (authentication call sites and the `/api/auth/link` and `/api/auth/signout` routes)

**Interfaces:**

- Consumes: `loadIdentity` (Task 1).
- Produces:
  - `createSession(env, email, userAgent): Promise<string>`, which returns a `Set-Cookie` header value.
  - `authenticateBrowser(request, env): Promise<Identity>`, which reads the cookie only, slides the expiry when it was last seen more than an hour ago, and updates `last_active_at` at most every 5 minutes.
  - `authenticateKey(request, env): Promise<Identity & { keyId: string }>`, which reads the bearer only.
  - `signOut(request, env, everywhere: boolean): Promise<string>`, which returns a clearing `Set-Cookie`.
  - `redeemLink(env, token): Promise<string>`, which takes a single-use link valid for 15 minutes and returns `Set-Cookie`.
  - `createLink(env, email): Promise<string>`, used by tests and `member.mjs`. The SQL lives in `member.mjs`; this is the in-Worker equivalent.

Routes:

- `GET /api/auth/link?token=` redirects with 302 to `/` and sets the cookie.
- `POST /api/auth/signout` takes `{ everywhere?: boolean }`.
- `/api/session` returns `{ email, name, owner, permissions: Permission[] }`.

Router rules:

- `/api/*` except `/api/auth/*` uses `authenticateBrowser`. `/mcp` uses `authenticateKey`.
- For a request carrying a cookie whose method isn't GET or HEAD, the `Origin` must be present and equal to `url.origin`; otherwise return 403 "Cross-origin requests are not allowed".

Tests:

- [ ] **Step 1: Write failing tests in `auth.test.ts`.**
  - `a sign-in link creates a session once`: the first redeem returns 302 with `__Host-dt_session=` and `HttpOnly; Secure; SameSite=Lax; Path=/`. A second redeem returns 401.
  - `expired sessions and links are rejected`.
  - `sign out ends this session, everywhere ends all`.
  - `suspension ends existing sessions and keys`: set `status='suspended'`. Both the cookie request and the key request now get 403.
  - `cookie writes require same-origin Origin`:
    - a POST to `/api/tools/projects_list` with the cookie and no Origin gets 403;
    - with a foreign Origin, 403;
    - with the same Origin, 200.
  - `keys are refused on /api and cookies on /mcp`: both get 401.
  - `D1 stores only hashes`: no row in `auth_sessions` or `api_keys` contains the raw secret.
- [ ] **Step 2: Run** `npx vitest run src/server/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `auth.ts` and wire it into `index.ts`.** Remove `jose` Access verification and `ACCESS_*` from the code. Parse cookies by splitting on `; `. Use a constant-time comparison only where comparing secrets directly; hash lookups need none.
- [ ] **Step 4: Rerun the test.** Expected: PASS.
- [ ] **Step 5: Commit** with "Authenticate browsers with sessions and MCP with keys".

### Task 3: Google sign-in

**Files:**

- Create: `src/server/google.ts`, `src/server/google.test.ts`
- Modify: `src/server/index.ts` (routes), `wrangler.jsonc`, `vitest.config.ts`

Config:

- `wrangler.jsonc` vars: `GOOGLE_CLIENT_ID: ""` (filled in at setup) and `DAILY_BUILD_LIMIT: "100"`. The secret is `GOOGLE_CLIENT_SECRET`.
- Rate-limit binding `AUTH_LIMITER` with `simple: { limit: 20, period: 60 }`. Mirror it in `vitest.config.ts` miniflare `ratelimits`, along with test values for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Regenerate `worker-configuration.d.ts` with `npx wrangler types` once `index.ts` parses.

**Interfaces:**

- Consumes: `createSession` (Task 2).
- Produces:
  - `googleStart(request, env): Promise<Response>` redirects with 302 to `https://accounts.google.com/o/oauth2/v2/auth` with:
    - `response_type=code`, `scope=openid email profile`, `prompt=select_account`;
    - `redirect_uri=<origin>/api/auth/google/callback`;
    - `state`, `code_challenge` (S256) and `nonce`.

    It sets `__Host-dt_oauth` (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=600) holding `state.verifier.nonce`.

  - `googleCallback(request, env): Promise<Response>`:
    - checks the state cookie, then clears it;
    - POSTs to `https://oauth2.googleapis.com/token`;
    - verifies `id_token` with `createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))`: issuer `https://accounts.google.com` or `accounts.google.com`, audience `GOOGLE_CLIENT_ID`, the nonce, and `email_verified === true`;
    - links or creates the member, creates a session, and redirects with 302 to `/`.

    Errors redirect to `/?auth_error=<code>`, where the code is one of `state`, `google`, `unverified`, `suspended` or `rate`.

  - Linking order:
    1. a member with this `google_sub`, whose email is updated if it changed and isn't taken;
    2. otherwise a member with this email and `google_sub IS NULL`, which is linked;
    3. otherwise a member with this email and a different `google_sub`, which is refused with `google`;
    4. otherwise a new member at the default level with `name` from the token.

    Rate-limit by `CF-Connecting-IP` on both routes.

- [ ] **Step 1: Write failing tests** in `google.test.ts`, with `fetch` mocked for the token and JWKS URLs and the ID token signed with jose test keys.
  - `start sets state cookie and redirects with PKCE`.
  - `creates a Demo member on first sign-in and signs them in`.
  - `links an existing unlinked member by verified email`: an existing owner keeps `owner=1`.
  - `refuses a second Google subject for an already linked email`.
  - `rejects forged Google callbacks`: cases for a missing cookie, a state mismatch, a reused state, the wrong audience, the wrong nonce, an expired token and `email_verified:false`. Each redirects to `/?auth_error=…` and sets no session cookie.
  - `rate limits repeated starts`: the 21st request within the window redirects to `?auth_error=rate`.
- [ ] **Step 2: Run** `npx vitest run src/server/google.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `google.ts` and add the routes `GET /api/auth/google/start` and `GET /api/auth/google/callback`.**
- [ ] **Step 4: Rerun the test.** Expected: PASS.
- [ ] **Step 5: Commit** with "Sign in with Google".

### Task 4: Enforce permissions, demo projects and the build cap

**Files:**

- Modify: `src/server/core.ts`, `src/server/tools.ts`, `src/server/activity.ts`, `src/server/index.ts`
- Modify all existing tests (`workspace.test.ts`, `sessions.test.ts`) to use `member()` from `test-helpers.ts`, with explicit insert columns.
- Create: `src/server/permissions.test.ts`

**Interfaces:**

- Consumes: `require` and `member()` (Task 1).
- Produces:
  - `projectAccess(c, projectId, mode: "read"|"write" = "write")`. Read admits `owner=? OR (demo=1 AND <has demo.view>)`. Write admits only the owner. `modelAccess` and `revisionAccess` take the same `mode`.
  - `Tool.permission?: Permission`, replacing `adminOnly`.
  - `dispatch` calls `require(c, tool.permission)` before running.

Permission and mode per tool:

| Tool                                             | Permission                     | Access mode                                         |
| ------------------------------------------------ | ------------------------------ | --------------------------------------------------- |
| `projects_list`                                  | none                           | returns `{ own, demo }`, demo only with `demo.view` |
| `projects_get`                                   | none                           | read                                                |
| `projects_activity`                              | none                           | read                                                |
| `builds_get`                                     | none                           | read                                                |
| `projects_create`                                | `projects.create`              | —                                                   |
| `models_create`, `models_save`                   | `models.edit`                  | write                                               |
| `documents_add`                                  | `models.edit`                  | write                                               |
| `models_build`                                   | `builds.run`                   | write                                               |
| `models_set_parameter`                           | `models.edit` and `builds.run` | write                                               |
| `notes_add`                                      | `notes.write`                  | write                                               |
| `session_start`, `session_update`, `session_end` | none                           | write (MCP needs `keys.use` already)                |
| `skills_save`, `tools_configure`                 | `settings.manage`              | —                                                   |
| `skills_list`                                    | none                           | —                                                   |

Other rules:

- **Build cap:** `queueBuild` counts `jobs` with `created_by = me` and `created_at` in the last 24 hours. At `DAILY_BUILD_LIMIT` or above, it returns `AppError(429, "Daily build limit reached")`. Insert `created_by`.
- **Live ticket:** read mode.
- **Artifact route:** read mode. Anything not ending in `.glb` also needs `exports.download`.
- **Changing an existing call:** `projects_list` currently returns an array. The web client updates in Task 9, and the MCP skill text in Task 7.

- [ ] **Step 1: Write failing tests in `permissions.test.ts`.**
  - `each tool is denied without its permission and allowed with it`: a table-driven loop over the tools, with a Demo member denied 403 and an Admin allowed.
  - `demo viewer can read the demo project`: `projects_get`, `projects_activity`, `builds_get`, the GLB artifact and a live ticket all succeed.
  - `demo viewer cannot write to the demo through any tool`, even when holding Maker permissions:
    - `models_save`, `models_build`, `models_set_parameter`, `notes_add` and `documents_add` give 404;
    - `session_start` gives 404;
    - a STEP download without `exports.download` gives 403.
  - `members without demo.view do not see demo projects`.
  - `daily build limit`: with `DAILY_BUILD_LIMIT=2`, the third `models_build` gives 429.
- [ ] **Step 2: Run** `npx vitest run src/server/permissions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement, then update the old suites** to seed members through `member()` and explicit columns, replacing `role` with levels.
- [ ] **Step 4: Run** `npx vitest run`. Expected: every server suite passes.
- [ ] **Step 5: Commit** with "Enforce permissions per tool and add read-only demo projects".

### Task 5: API keys

**Files:**

- Create: `src/server/settings.ts` (key handlers first), `src/server/keys.test.ts`
- Modify: `src/server/index.ts` (routes), `src/server/auth.ts` (`authenticateKey` requires `keys.use` and throttles `last_used_at`)

**Interfaces:**

- Consumes: `authenticateBrowser`, `require`.
- Produces routes (cookie-authenticated, JSON):
  - `GET /api/settings/keys` returns `[{ id, name, prefix, created_at, expires_at, last_used_at }]`, covering active keys only.
  - `POST /api/settings/keys` takes `{ name: 1–60 chars, days: 30|90|365 }`. It requires `keys.use` and returns `{ id, name, key, expires_at }`, the only time `key` is returned. At 10 active keys it returns 409 "You have 10 active keys; revoke one first".
  - `DELETE /api/settings/keys/:id` sets `revoked_at`, and only for the member's own keys; otherwise it returns 404.

- [ ] **Step 1: Write failing tests in `keys.test.ts`.**
  - `creates a key shown once and usable on /mcp`: `tools/list` returns 200. A later `GET` doesn't contain the key, and D1 holds only the hash.
  - `revoked and expired keys stop working`.
  - `ten active keys maximum`.
  - `losing keys.use disables every key`: revoke `keys.use` for the member, and the existing key gets 403 on `/mcp`.
  - `cannot revoke another member's key`: returns 404.
  - `last_used_at is written at most every five minutes`: two calls give one update. Fake the time with `vi.setSystemTime`.
- [ ] **Step 2: Run** `npx vitest run src/server/keys.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Rerun the test.** Expected: PASS.
- [ ] **Step 5: Commit** with "Let members create and revoke their own API keys".

### Task 6: Members, levels, demo flag and account

**Files:**

- Modify: `src/server/settings.ts`, `src/server/index.ts`
- Create: `src/server/members.test.ts`

**Interfaces:**

- Consumes: `require`, `loadIdentity`.
- Produces routes:
  - **Members** (require `members.manage`):
    - `GET /api/settings/members` returns `[{ email, name, owner, status, level_id, allow: Permission[], revoke: Permission[], last_active_at, created_at }]`.
    - `PATCH /api/settings/members/:email` takes `{ level_id?, allow?, revoke?, status?, owner? }`. Changing `owner` requires the caller to be an owner.
  - **Levels**:
    - `GET /api/settings/levels` returns `[{ id, name, is_default, permissions, members }]`. It requires `members.manage`.
    - `POST /api/settings/levels` takes `{ name, permissions }`.
    - `PATCH /api/settings/levels/:id` takes `{ name?, permissions?, is_default? }`.
    - `DELETE /api/settings/levels/:id` returns 409 while the level has members or is the default.
  - **Account:**
    - `GET /api/settings/account`
    - `PATCH /api/settings/account` takes `{ name }`.
  - **Demo flag:** `PATCH /api/settings/projects/:id/demo` takes `{ demo: boolean }`. It requires `settings.manage` and that the caller owns the project.

Rules:

- **Non-owner with `members.manage`:**
  - cannot edit their own row;
  - cannot edit a member whose effective permissions aren't a subset of the caller's;
  - cannot add an allow, or a level whose permissions exceed the caller's own;
  - cannot edit a level whose permissions exceed the caller's own.
- **The last owner** can't be demoted, can't be suspended and can't remove their own ownership; each attempt returns 409 "At least one active owner must remain".
- **Audit:** every change writes an `audit_events` row in the same `DB.batch` as the change.

- [ ] **Step 1: Write failing tests in `members.test.ts`.**
  - `owner promotes a Demo member and the change applies immediately`: before the change, `projects_create` gives 403; after, it gives 200 with the same session.
  - `per-person allow and revoke override the level`.
  - `delegated admin limits`: covers the four refusals above plus `owner` changes, each returning 403.
  - `last owner cannot be removed`.
  - `levels: create, edit, delete in use refused, set default`: a new Google member gets the new default level.
  - `every change is audited`.
  - `demo flag requires settings.manage and ownership`.
- [ ] **Step 2: Run** `npx vitest run src/server/members.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: every suite passes.
- [ ] **Step 5: Commit** with "Manage members, access levels and the demo project".

### Task 7: Remove Access, update the operator tooling and the skill

**Files:**

- Modify:
  - `wrangler.jsonc` (drop `ACCESS_*`)
  - `vitest.config.ts`
  - `worker-configuration.d.ts` (regenerate)
  - `ci/member.mjs`
  - `ci/verify-release.mjs`
  - `skills/modeling/SKILL.md` (the `projects_list` shape, and that a demo is read-only)
  - `src/server/index.ts` (CSP unchanged apart from Google: navigation is a redirect, so no new script source is needed)

`ci/member.mjs` usage becomes:

```
node ci/member.mjs --local|--remote email owner|member output
```

- It upserts the member. `owner` sets `owner=1` and the Admin level; `member` sets the default level.
- It inserts a `signin_links` row and writes `<path>/api/auth/link?token=…` to `output` with mode 0600. The link is single use, valid for 15 minutes, and never logged.
- It is used for local development and owner recovery.

`verify-release.mjs` expects 401 from both `/api/session` and `/mcp`, and 302 from `/api/auth/google/start` to `accounts.google.com`.

- [ ] **Step 1: Make the changes.**
- [ ] **Step 2: Run** `bash ci/run.sh`. Expected: formatting, types, Worker tests, the web build, audit, the Python checks and packaging all pass.
- [ ] **Step 3: Commit** with "Retire Cloudflare Access and update operator tooling".

### Task 8: Name model

**Files:**

- Create:
  - `examples/brand/name.py`
  - `examples/brand/fonts/Inter-Bold.ttf` and `examples/brand/fonts/OFL.txt`
  - `public/brand/deal-toy-name.glb`
  - `examples/brand/README.md` (what it is, and how to rebuild it)
- Modify: `THIRD_PARTY_NOTICES.md`, `examples/README.md`

Model:

- `build()` returns `bd.Compound(children=[mark, text], label="Deal Toy name")`.
- The text is `bd.Text("Deal Toy", font_size=56, font_path=<bundled TTF>, align=(CENTER, CENTER))`, extruded 22 mm with a 1.5 mm fillet or chamfer where OCCT allows it.
- The mark is a 48 mm square frame with a 6 mm wall, rotated 45°, extruded 22 mm and placed left of the text with a 12 mm gap.
- Labels: "Name" and "Mark".
- Build it through the existing engine runner in the `deal-toy-cad` container, as the repository's other examples are built, and commit the GLB.
- If OCCT can't load the bundled font in the container, report that and fall back as the design allows.

- [ ] **Step 1: Write `name.py`.**
- [ ] **Step 2: Build it.** Use the command the existing `examples/README.md` documents for building an example. Expected: a GLB under 2 MB, with two labelled parts and roughly 570 × 60 × 22 mm bounds in the report.
- [ ] **Step 3: Check the GLB in a glTF viewer through Chrome DevTools.**
- [ ] **Step 4: Commit** with "Model the Deal Toy name in Deal Toy".

### Task 9: Sign-in screen and cookie-based client

**Files:**

- Create: `src/web/SignIn.tsx`, `src/web/NameStage.tsx`
- Modify: `src/web/api.ts`, `src/web/main.tsx`, `src/web/style.css`

**Interfaces:**

- Consumes: `/api/session`, `/api/auth/google/start`, and `public/brand/deal-toy-name.glb`.
- Produces:
  - `type Session = { email; name; owner: boolean; permissions: Permission[] }`
  - `can(session, p): boolean`, which is true for owners and for listed permissions.

Client:

- `request()` drops the bearer and `sessionStorage`, and uses `credentials: "same-origin"`.
- On a 401 from `/api/session`, render `<SignIn />`.

`SignIn` matches the mockup:

- A tab switch between "Sign in" and "Create account" that only changes the copy.
- One "Continue with Google" link to `/api/auth/google/start`.
- Create account shows "New accounts start with the demo. An admin can give you more access."
- `?auth_error=` maps to friendly text:
  - `state`: "Sign-in expired. Try again."
  - `google`: "That Google account is linked to a different Deal Toy account."
  - `unverified`: "Use a Google account with a verified email."
  - `suspended`: "This account is suspended."
  - `rate`: "Too many attempts. Wait a minute."

`NameStage`:

- Loads the GLB once, with the transparent renderer and theme grid like the existing `Viewer`.
- OrbitControls: zoom and pan off, damping 0.06, auto-rotate at 0.6 that pauses on drag and resumes after 4 s.
- Fog scaled to the camera distance.
- `setViewOffset` keeps the model clear of the card: to the left on wide screens, above it under 760 px.
- Raise the contrast: light theme `#cfd0cc` at metalness 0.2, dark theme `#9fa3ad`.
- It is lazy-loaded with `React.lazy`, so the card paints first.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm run build`. Expected: success, and the sign-in route loads three.js only in the lazy chunk.
- [ ] **Step 3: Check in Chrome DevTools** at 1440×860 and 390×844 (mobile emulation), in light and dark. The name renders, dragging spins it, the tab copy changes, and each error code shows its text.
- [ ] **Step 4: Commit** with "Add the sign-in screen with the 3D name".

### Task 10: Settings and permission-aware workspace

**Files:**

- Create: `src/web/Settings.tsx`
- Modify: `src/web/main.tsx` (nav, routing, Library with demo projects, Extensions gated by `settings.manage`), `src/web/Workspace.tsx`, `src/web/ChatPanel.tsx`, `src/web/style.css`

Settings sections, as in the mockup:

- **Account:** name editing, email, sign out, and sign out everywhere.
- **API keys:**
  - The list, plus a create dialog with a name and an expiry select.
  - A one-time reveal with "Copy key" and "Copy Claude Code command".
  - Revoke.
  - Without `keys.use`, the section shows "API keys need the “API keys and MCP” permission. Ask an admin."
- **Members:** shown only with `members.manage`. It has search, level chips with a "+N/−N" badge, and a side panel with the level select, a Level/Allow/Revoke control per permission, owner (for owners only), suspend and save.
- **Access levels:** shown only with `members.manage`. It has the permission grid, new level, rename, delete and set default.

Workspace:

- `readOnly = project.owner !== session.email`.
- When read-only, hide the composer (replaced by "You're viewing the demo. Ask an admin for access to build your own."), the popover edit controls, Build, Save and the code edit mode.
- Downloads show only with `exports.download`. The GLB viewer always works.
- The Connect drawer text becomes "Create a key in Settings → API keys." with a link.
- The project ⋯ menu gets "Show as demo" / "Stop showing as demo" with `settings.manage`.
- A Demo-level member with exactly one demo project and no projects of their own opens straight into the demo workspace.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `bash ci/run.sh`. Expected: PASS.
- [ ] **Step 3: Run the app locally** with `npm run dev` and use `node ci/member.mjs --local …` to sign in as the owner and as a Demo member. Check in Chrome DevTools at 1440 and 390 px, light and dark:
  - the owner creates a key, copies it and revokes it;
  - the owner promotes the Demo member, and the member's UI gains controls after a reload;
  - the Demo member sees the read-only demo and cannot see Members.

  Save screenshots to `docs/images/`.

- [ ] **Step 4: Commit** with "Add settings for keys, members and access levels".

### Task 11: Docs, PR and rollout notes

**Files:**

- Modify: `README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/validation.md`, `docs/roadmap.md`, `AGENTS.md` (if setup commands change)

- [ ] **Step 1: Update the docs.**
  - **Local quickstart:** `member.mjs` sign-in links.
  - **Connect an agent:** Settings → API keys.
  - **Architecture:** auth, permissions and the demo.
  - **Deployment:** the Google OAuth client setup, the secret, and the rate-limit binding. After verification, the two Access applications are deleted with the owner's approval.
  - **Validation:** local results, and production marked as pending.
  - **README:** says "anyone can sign up; new accounts get the demo".
- [ ] **Step 2: Run** `bash ci/run.sh` and `bash ci/container-smoke.sh`. Expected: both pass.
- [ ] **Step 3: Push the branch and open the PR.** The body covers the problem, the behaviour, validation and the risks: the owner's Google client must exist before deploy, and the Access apps are deleted only after production checks.
