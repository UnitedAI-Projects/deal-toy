# Validation and rollout record

2026-10-27, initial foundation (historical record; see subsequent updates below). This record separates implementation, local validation, hosted checks and deployment.

## Local evidence

- Thirteen Worker integration tests pass: identity and token handling, anonymous denial, project ownership, immutable revisions, concurrent-write conflicts, cross-project document references, document versioning, administrator-only tool configuration, disabled tools, cross-origin denial, MCP initialization, duplicate build delivery, export persistence and partial-export cleanup.
- Five native Python tests pass: real OCCT construction and STEP round-trip geometry, GLB/STL outputs, invalid-model refusal, timeout termination and source-size limits.
- TypeScript checks, production browser build, Python lint and npm dependency audit pass. Worker packaging dry-run passes independently of the native image test.
- The initial Linux ARM64 container built and exported STEP/STL/GLB/facts with networking disabled, a read-only filesystem and bounded memory/processes. The final image removes redundant uv package-cache data and completed the full browser-to-queue-to-container build successfully.
- Browser verification on the development host: authenticated project creation, immutable source save, failed-job display, interrupted-job expiration and revision-linked manufacturing brief persistence. Successful queued build and 3D viewing were verified; the authenticated downloaded STEP was re-imported and measured at 100 × 55 × 51 mm and 62,900 mm³. MCP projects_list returned the saved project. Skill publication and project-wide/revision-linked document versions were verified. The mobile workspace and document flow were checked at 390 × 844 with no horizontal page overflow. Screenshots are in docs/images. This was tested on the development host; MacBook access has not been verified.

The local Docker backend exhausted its internal-disk space while starting a container. Only this task's known image and build-cache records were removed. Other projects' Docker resources were preserved. The image now avoids retaining the uv download cache. [Hosted Linux AMD64 checks passed](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40626920530), including the native container build and network-disabled export smoke test.

## Cloudflare and GitHub setup

- Repository: private `UnitedAI-Projects/deal-toy`, originally empty. A documentation-only main branch was initialized; implementation stays on `feat/cad-workspace-foundation`.
- Existing personal Cloudflare account verified. Dedicated D1 `deal-toy` (`01262ea9-4640-464f-870c-2c7618f5fb5a`), private R2 `deal-toy-artifacts`, and Queue `deal-toy-builds` created. No customer data is present.
- GitHub production environment created and restricted to main. Account ID is configured as an environment secret. `DEPLOY_ENABLED=false` while activation is incomplete.
- Dedicated Cloudflare CI API token, application URL, production membership and browser Access setup are not configured. No production deployment or live CAD acceptance is claimed.
- GitHub Actions is enabled. The organization billing-usage API was unavailable to the current credential; the hosted run executed successfully. Usage limits may still apply to later runs.

- Branch protection was rejected by GitHub with HTTP 403 because the current plan does not support it for this private repository. CI exists, but required-check enforcement is unavailable. Keep the repository private.

Implementation is pushed in [PR #1](https://github.com/UnitedAI-Projects/deal-toy/pull/1). The initial hosted run passed; the final revision adds build lifecycle regression coverage and aligns queue concurrency with the two-container limit. Its checks must pass before merging. Production activation remains pending a dedicated deployment token and live acceptance.

## Deployment activation — 2026-10-28

PR #1 merged as `a0f6b72`. The dedicated 90-day account deployment token is configured in GitHub’s production environment, and an administrator app membership exists. The first token failed D1 authorization; its replacement passed D1 migration, Worker upload and CAD image registry push. [Deployment attempt 2](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40631004261/attempts/2) then failed because this account requires `durable_object` scheduling instead of `default`. The app was not yet serving at this point.

The scheduling fix uses a version-pinned named CAD image and the direct Durable Object Container API. Local validation passed 17 Worker tests, 5 Python tests, formatting, type checks, browser build, dependency audit and Worker packaging. New coverage checks startup isolation, readiness retries/deadline, missing-image refusal and no replay of a failed build POST. Production deployment and authenticated acceptance remain pending this fix.

## Native thread-pressure regression — 2026-10-28

PR #6 passed hosted validation on retry and merged as `f88dcce`, but the main deployment checks reproduced a pre-existing native export timeout. An isolated Linux AMD64 box export with 64 same-user background threads consistently failed; a stack dump located the stall in OCCT’s STL mesher. Linux `RLIMIT_NPROC` counts other same-user tasks, so implicit parallel exporter thread creation can fail even for small models.

The runner now selects OCCT’s own single-thread pool before applying its existing limits. The same Linux regression passed three times under the original memory, process, filesystem and network constraints. The regression is also in the hosted Python suite. No timeout or resource limit was increased. Production remains pending validation and deployment of this correction.

## Live startup correction — 2026-10-28

[Production deployment](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40708297053) succeeded for `c71e376`. The HTTPS app and authenticated session were verified from the MacBook; project/revision creation works. GitHub verified the release SHA and anonymous API denial. Initial live CAD jobs exposed a separate container startup failure: Python’s HTTPServer reverse-resolved Cloudflare’s long container hostname and raised `UnicodeError: label too long` before opening port 8080.

The internal listener now binds without reverse DNS and uses the fixed service name `cad`. A regression injects the exact hostname error; the container smoke test starts the actual HTTP listener under a 64-character hostname and requests a build over loopback. Completed live CAD acceptance must be recorded after this correction is deployed. Earlier activation notes above are historical.

## Live agent workspace — 2026-10-28

Local evidence for the live agent workspace and interface redesign:

- 33 Worker tests pass. New coverage: session recording order and outcomes, session-less and interface recording (reads excluded), argument clipping, refusal of another member's session and of cross-project session use, single delivery of notes to running sessions, held notes delivered only to the next session, notes appended to MCP results as quoted data, parameter edits (value-only source change, team-edit event, range, stale revision, unknown parameter, ownership), single-use live tickets, owner-only ticket issue, live event delivery over a WebSocket, and cross-origin socket refusal. `setParameter` unit tests cover quoting styles, integer literals, computed values, duplicates and unsafe names.
- 8 native Python tests pass (1 Linux-only skip on macOS), including `PARAMS` and labelled-part facts and GLB node labels.
- Formatting, both type checks, the browser build, the dependency audit, Python lint and the Worker packaging dry run pass via `bash ci/run.sh`.
- End-to-end with `wrangler dev` and the local CAD container: a real Claude Code agent connected over MCP, followed the updated modeling skill, and its verbatim prompt, updates and calls streamed into the browser as they happened. The built model appeared when its build finished without a reload. Clicking a part opened its parameters; changing `ARCH_RISE` from 50 to 58 produced a one-line source change, a new revision and a rebuild (height 98 → 106 mm). A note from the browser was delivered to the next MCP session. Light, dark and 390 × 844 layouts were checked without horizontal overflow. Screenshots are in `docs/images`.
- Found during this testing and fixed: GLTFLoader rewrites node names (spaces to underscores), which broke selection of multi-word parts; computed `PARAMS` values were briefly treated as editable; a socket close code crashed the relay.
- A dev-server reload during a running build leaves that job "running" until the 15-minute sweep. This is existing behaviour, seen locally because of code reloads.

Hosted CI passed on the final PR revision (`468ee88`, [run](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40724363504)). That revision also made every tool, including self-recording ones, check session ownership and project, with regression tests on all three channels.

### Production deployment

[PR #9](https://github.com/UnitedAI-Projects/deal-toy/pull/9) merged as `071ceae`. [The deploy run](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40724789413) succeeded:

- D1 migration `0002_sessions.sql` was applied.
- The `ProjectLive` Durable Object was bound.
- The Worker and assets were uploaded.

Checks after the deploy, from the Mac mini and the MacBook:

- `/health` reports release `071ceaeeeecc07aefb232df5a33330bda107fba9`.
- Anonymous requests to `/api/session`, the live-ticket route and a socket upgrade with a malformed ticket all return 401.
- The page's Content-Security-Policy allows `wss:` to its own host.

Not yet verified in production:

- A signed-in session. No production token was available on the verifying host.
- A real agent session over the production MCP endpoint.
- A session watched from a second browser.

## Accounts, access levels and API keys — 2026-10-28

Branch `feat/accounts-access`. Local evidence only; production is pending the owner's Google OAuth client and the Access cutover in [deployment](deployment.md#cutover-from-cloudflare-access).

- `bash ci/run.sh` passed: formatting, TypeScript (server and web), 76 Worker tests in 10 files, the web build, `npm audit` (0 vulnerabilities), ruff, 8 Python tests (1 skipped) and the Wrangler packaging dry run.
- **Worker tests:**
  - the accounts migration;
  - effective permissions;
  - sign-in links;
  - session expiry, sign-out and suspension;
  - same-origin cookie writes;
  - keys only on `/mcp`;
  - Google start and callback with mocked token and certificate endpoints: forged state, audience, nonce, expiry, unverified email, account linking and rate limits;
  - permissions per tool;
  - demo reads and refused demo writes;
  - source and member emails withheld from viewers, including the live feed;
  - the daily build cap;
  - API key lifecycle;
  - member and level management, including delegated-admin limits and the last owner.
- **Browser (Chrome DevTools, local Worker on port 8788):**
  - The sign-in screen renders the Mantel GLB in light, dark and at 390 px. Dragging spins the name, the tab copy changes, and `?auth_error=` messages show and clear.
  - A sign-in link signed in the owner, with the session cookie not readable by page scripts, and sign-out ended the session.
  - The owner built a project with the local CAD container, marked it as the demo, created an API key that listed tools over `/mcp`, and edited a member and the levels.
  - A Demo-level member opened straight into the demo: view-only chip, no composer, read-only dimensions, "team" in place of emails.
  - Promotion to Maker took effect on reload.

  Screenshots: `docs/images/signin-*.png`, `settings-*.png`, `demo-viewer.png`.

- **Not yet verified:**
  - real Google sign-in (no OAuth client configured locally);
  - production deployment and migration;
  - deleting the Access applications.

## Accounts migration rehearsal — 2026-10-28

Before activating PR #13, a private production D1 export was restored to a local SQLite database, migration `0003_accounts.sql` was applied, and foreign-key checks passed. Existing row counts were preserved: 2 projects, 1 model, 1 revision, 3 jobs, 4 artifacts, 1 document and 1 member. The existing token's hash/email/expiry migrated unchanged to an API key, and the active administrator became an active owner. A second local database restored from the export matched the original row counts and token records. Production migration and real Google OAuth verification remain pending configuration and deployment.
