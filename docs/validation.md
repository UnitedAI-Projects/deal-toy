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

Pre-merge regressions reproduced two account failures: legacy migrated key IDs returned 404 when revoked, and a database batch could remove all active owners. The revoke route now accepts legacy IDs; migration `0004_last_owner.sql` enforces the active-owner invariant inside the transaction. Both regressions pass, including rollback of the attempted multi-owner update. The guard was also exercised on the private production-data rehearsal copy. Full local checks pass with 78 Worker tests and 8 Python tests (1 existing skip).

### Google OAuth client configuration — 2026-10-28

Created the Mantel production web client in Google Cloud project `unitedai-mantel-prod`, with the production and localhost callback URLs requested by the owner. Set its public client ID in Wrangler and stored `GOOGLE_CLIENT_SECRET` directly in the Worker; the temporary plaintext file was removed after secret-list verification. No secret is committed.

`npm run types` now uses `--strict-vars=false` so regenerated environment types support different test/deployment values. Full local `bash ci/run.sh` passed: 78 Worker tests, 8 Python tests with 1 existing skip, format/types/build/audit and Wrangler dry run. Real Google sign-in and this accounts release remain unverified in production. Google publishing is blocked until the required public branding pages and privacy-policy URL are available; the OAuth audience remains External / Testing. PR #13 is not yet merged.

### Approved privacy publication — 2026-10-28

The owner approved the policy for publication. PR #14 publishes the canonical HTML policy and public homepage under `/info/`, independently of the accounts migration. Desktop and 400px mobile rendering were inspected, and a paragraph comparison verified preservation of the approved policy text. A dedicated Access application and reusable Bypass policy expose only `/info/*`; anonymous `/api/session` and `/infox` still return the Access redirect, and `/mcp` still returns 401.

Integrated the public-page release into the accounts branch and linked the policy from Sign in and Settings → Account. Replaced the draft with a pointer to the approved canonical HTML. Full local `bash ci/run.sh` passed again: 78 Worker tests, 8 Python tests / 1 existing skip, formatting, types, build, audit and dry run. Google publishing and live accounts acceptance are pending at this checkpoint.

### Production Google login and Access cutover — 2026-10-28

PR #13 deployed successfully in [run 40764526525](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40764526525), release `c784673921ce11d917b511c3fe8fbf1f69e62cd2`. The owner then approved removing all three Mantel-specific Access applications. Cloudflare's applications list showed only the four unrelated applications afterwards; the shared personal-app policy was preserved.

Post-cutover verification:

- Anonymous HTTP checks from the MacBook: `/` 200, `/api/session` 401 JSON, Google start 302 directly to `accounts.google.com`, `/health` 200 with the expected release, and both public information pages 200.
- Chrome on the Mac mini: owner sign-out showed Mantel's own sign-in page; Continue with Google opened Google's account chooser directly, and signing in as the existing owner restored both projects.
- The migrated MCP key successfully called `projects_list`; anonymous MCP returned 401.

No application code or database data changed for this cutover. MacBook browser sign-in and second-account production signup/promotion/suspension were not tested. Earlier sections record historical pre-deployment limitations; this entry supersedes their pending Google OAuth and Access-cutover status.

### Engine build time and export size — 2026-10-29

After PR #17's font fix, the 41.9 KB DigitalBridge × ArcLight demo model (49 parts, 168 solids, two vector logos and four lines of lettering) still exceeded the 60-second limit in production. A timing probe built in production reported, at one CPU share:

- 22.1 s of interpreter start-up before the model ran. The image installed packages without bytecode, and each job's fresh, read-only container compiled every module from source. On a Mac, a cold compile added about 2.7 s to a 1.8 s import.
- 8.8 s for the model, 5.4 s for its 14.2 MB STEP file and 6.3 s for its GLB.

The demo model's outputs also totalled 22.3 MB, over the 15 MiB artifact limit, so faster hardware alone would not have fixed it. The engine now:

- **Ships compiled bytecode:** dependencies and the standard library are compiled when the image is built. The container smoke test checks that build123d and the standard library have bytecode in the read-only image.
- **Writes STEP without surface curves:** pcurves are left out, because readers rebuild them from the 3D geometry. The demo model's STEP file drops from 12.4 MB to 5.1 MB and exports 40% faster. The existing round-trip test still re-reads the STEP and checks it is valid with the same volume.
- **Meshes GLB at STL tolerances:** the viewer mesh uses the STL tolerances (0.05 linear, 0.1 rad), not build123d's 0.001 default. The demo model's GLB drops from 6.3 MB to 4.5 MB. A new test checks that the GLB has no more triangles than the STL.

No timeout or resource limit was changed.

PR #18 merged as `8ad4dd5`. Its Deploy run, [40905595697](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40905595697), deployed successfully, but its last step failed. That step checks the release on `/health` once, and it read it before the new release was serving, the same race as PR #17's run. Run again by hand afterwards, the same script passed against release `8ad4dd5`.

In production, the demo model's rebuild succeeded in 57.9 s from queue to result, including container start:

- **Model:** 200 × 90.25 × 123 mm, 49 parts, 168 solids, valid, with 8 parameters.
- **Files:** STEP 5.9 MB, STL 3.5 MB and GLB 4.7 MB, 13.2 MB in total.

Two more timing probes showed the effect of compiled bytecode:

| Probe        | Start-up                | Model build |
| ------------ | ----------------------- | ----------- |
| Typical host | 8.5 s, down from 22.1 s | 7.5 s       |
| Slow host    | 30.7 s                  | 21.9 s      |

On a typical host the demo model has ample margin. The slow host ran about 2.5× slower, and a model this large could still exceed 60 s there. Probe exports used build123d's defaults, so they are not the runner's export times.

## Modeling actions core — 2026-11-05

Branch `feat/modeling-actions-core`, implementing `docs/superpowers/plans/2026-11-05-modeling-actions-core.md`. Local evidence only; not deployed.

- `npm run check` passed: formatting, type checks, 182 Worker tests, browser build, dependency audit, ruff, 34 engine tests with 10 skips, and the Wrangler dry run. The skipped engine tests need the Liberation fonts or Linux; all 44 engine tests passed inside the CAD image built from this branch, and CI now installs `fonts-liberation`.
- The reference model `examples/deal_toy_steps.py` built in the CAD container with all seven steps `ok`. Its holes stayed on the intended face across `BLOCK_W` 40–150 mm and `HOLE_D` 2–10 mm, checked on the exported STEP. A face query left with two equally near candidates by a parameter change failed with `ambiguous_reference` instead of choosing one.
- In the app (local `wrangler dev` with the local CAD container), the timeline showed the seven steps; turning off `Mount hole 2` saved revision 2, rebuilt it, greyed the step and logged "Turned off step". Light, dark and 390 px layouts were checked; the step strip scrolls inside its row without page overflow. Screenshot: `docs/images/workspace-steps.png`.
- Not yet covered: saved custom actions and presets, view as of a step, and the toolbar, forms and pick-to-fill references, which follow in two later plans.

## Saved actions, presets and view-as-of — 2026-11-05

Branch `feat/saved-actions`, implementing `docs/superpowers/plans/2026-11-05-saved-actions.md`. Local evidence; not yet deployed.

- `npm run check` passed (formatting, types, Worker tests, build, audit, ruff, engine tests, Wrangler dry run). Engine tests that need the Liberation fonts or Linux skip on macOS and passed inside the CAD image built from this branch.
- In the local app (`wrangler dev` with the local CAD container): `examples/saved_actions/finger_notch.py` was saved with `actions_save`; its check build ran the example against the model and the version became `ready`. Added as a step with `steps_add` (`action: "finger-notch@1"`), it built `ok` and created `notch`, and the timeline showed it as step 8. `builds_view_as_of` at step 2 returned a preview build of only the first two steps, and the timeline's "View as of this step" showed the model at step 3 with later features hidden (`docs/images/workspace-as-of.png`).
- An automated security review of the branch found that versions still being checked were readable by anyone, and that another project could save the next version of an action or preset id. Both are fixed: unready versions are visible only to their maker and those who may change them, and an id belongs to the project (or team) that saved its first version.

## Inspect core — 2026-11-06

Branch `feat/inspect-core`, implementing `docs/superpowers/plans/2026-11-06-inspect-core.md`. Local evidence; not deployed.

- Engine tests compare record values with analytic ones: box faces and thicknesses, holes (diameter, depth, through), fillet radii, pair distance and overlap, and a box's tip angle `atan(5/20)`, all to 1e-6. The deal-toy fixture reports the coin's embed wall as 1.5 mm, the engraving as 0.3 mm (not matching `ENGRAVE_D`) and a density-weighted tip angle of 17.07°. Removing one density switches the result to uniform density.
- Inspection adds 0.02 s to the bridge example (24 faces), 0.48 s to the 288-face steps example (66 KiB record) and 0.02 s to the inspection fixture, measured in the CAD image. Not yet measured on the 49-part production demo model.
- In the app (local `wrangler dev` with the CAD container), clicking the block front showed 7200.00 mm², normal (0, −1, 0) and thickness 1.50 mm. A cut along X showed the coin's section 1.5 mm behind the front face, with each part in its own shade (`docs/images/workspace-inspect.png`). Two picks showed the between row. `view_highlight` turned the face amber in the live viewer with the agent's message (`docs/images/workspace-agent-highlight.png`). Checked at 390 px and in both themes.

## Actions interface — 2026-11-06

Branch `feat/actions-interface`, stacked on `feat/inspect-core`. Local evidence; not deployed.

- In the app (local `wrangler dev` with the CAD container, on the deal-toy steps fixture):
  - "+ Add step" → Hole: a pick on the block top filled `on`, diameter 6 and depth 10 showed a dashed ghost cylinder, and "Add step" built a new revision with the hole `ok`.
  - Construction plane: after the engine started naming faces, a pick gave `face("Block", "top")`, and distance 5 showed a ghost plane 5 mm above (`docs/images/workspace-actions.png`). It was saved as the preset "Five above" and added as step 9, `ok`.
  - Timeline: "Edit" changed the hole's diameter to 8 in revision 4, and dragging the Hole chip onto the plane's chip moved it after the plane in revision 5.
  - A click stored the owner's selection for the agent's summary.
  - At 390 px the page did not scroll sideways, and the action menu and form fit the screen.

## Inspect checks — 2026-11-09

Branch `feat/inspect-checks`, implementing `docs/superpowers/plans/2026-11-09-inspect-checks.md`. Local evidence; not deployed.

- Engine tests compare draft with analytic values (vertical walls 0°, a 2° taper and a 3° cone to 1e-6), check the enclosure fixture's rib–boss overlap against the analytic volume and its 0.30 mm lip, and confirm that reloading each example's STEP keeps every face's index. Measure mode gives 8.0 mm from a 4 mm pin to a wall 10 mm from its axis, and 0.30 mm between the enclosure's lip faces addressed by record index. It runs no model code. The suite passed inside the CAD image (`ci/engine-tests-in-image.sh`), and the container smoke test now calls `/measure`.
- Migration 0008 rebuilds `jobs` (to allow the `measure` purpose) together with `artifacts`, its only child. Dropping only `jobs` failed at commit with a foreign key error in SQLite, even with deferred foreign keys. The rebuild was tested on populated data in SQLite, in workerd's D1 (`src/server/migration-0008.test.ts`) and with `wrangler d1 migrations apply --local` on an existing local database (13 jobs, 55 artifacts, no orphans, empty `foreign_key_check`).
- In the app (local `wrangler dev` with the CAD container):
  - On `deal_toy_inspect.py`, the "Acrylic embedment" preset added three checks with limits marked TBD. Setting the coin wall to 2.00 mm failed it at 1.50 mm (`docs/images/workspace-checks.png`).
  - On `enclosure_inspect.py`, the "Moulded part" preset failed draft at 0.0° and no overlap at 238.59 mm³. A face-to-face lip check was added by index (as an agent would), and "Measure" ran a real measure job that returned 0.30 mm.
  - Typing 2.5 on the wall thickness saved revision 2. Its build queued the lip measurement by itself, and the overlap row read "238.59 mm³ in rev 1 → 243.49 mm³ in rev 2". The thicker wall also produced a real new overlap between a boss and the cover's lip, which is now coloured (`docs/images/workspace-checks-enclosure.png`).
  - Dragging the wall's handle showed the preview plane and a live value clamped to `WALL_T`'s 4.00 mm maximum, and release saved revision 3 (`docs/images/workspace-drag.png`).
  - Over MCP with an API key, `checks_results` returned the same results with the summary line `Checks: 0 pass · 3 fail (Housing draft 0.0° < 1.0°; No overlaps 298.45 mm³; Lip gap 0.30 mm < 0.50 mm)`.
  - Checked in light and dark themes and at 390 px (no horizontal scroll; `docs/images/workspace-checks-mobile.png`).
- Costs, measured in the CAD image: inspection takes 0.06 s on the enclosure (55 faces, 16.2 KiB record) and 0.02 s on the deal toy (23 faces, 7.3 KiB), and one measure job takes 1.0–1.3 s.
- Known limits: failure colours on a part fully inside another (the coin in its block) are hidden by the host and by section caps, as pick highlights already are. The check row still names the failure. The drag preview is a square of the face's area, not its outline.

## Inspect fit — 2026-11-09

Branch `feat/inspect-fit`, implementing `docs/superpowers/plans/2026-11-09-inspect-fit.md`. Local evidence; not deployed.

- **Engine tests:**
  - The presentation-box fixture records three joints with their kind, frame, range and value: the lid is revolute on the base (0–110°), the drawer is linear on the base (0–40 mm), and the plaque is rigid on the lid.
  - Its two placements match their parameters. A copy whose connect call ignores `DRAWER_OUT` reports `matches_param: false`.
  - The following cases each record only what the viewer can move, and leave a warning:
    - a part moved by two joints;
    - a cycle of joints;
    - a rigid joint connected to a sliding one;
    - a ball joint.

    An unbounded range is written as `null`.

  - A test pins `RevoluteJoint._angle`, which build123d 0.13 keeps private.
  - Reloading the new example's STEP keeps every face index.
  - The engine suite passed inside the CAD image (`ci/engine-tests-in-image.sh`, 103 passed).
- **Viewer math:** `src/web/fit.test.ts` applies the browser's joint transforms to the closed box's record and compares the result with build123d's record of the same box opened (lid at 60°, drawer out 25 mm). Every part's centre of mass agrees to 1e-4 mm, including the plaque, which moves only because it rides on the lid. Flipping the hinge's sign makes the test fail.
- **In the app** (local `wrangler dev` with the CAD container):
  - **Explode:** the box explodes along its joints: the lid lifts, the drawer slides out, and the plaque lifts off the lid along its joint's axis. The enclosure has no joints, so its parts stack along Z around the housing, and the ribs rise out of it.
  - **Picking:** a face picked on the exploded drawer reads the record's values (5880.00 mm², normal (0, 0, 1), 14.00 mm thick), with its highlight on the moved part (`docs/images/workspace-explode.png`).
  - **Section:** a cut works while exploded, with every moved part's cut filled.
  - **Dragging:** in **Move parts**, dragging the lid upward showed "Lid angle 32.0° · Preview". Release saved revision 2, `LID_ANGLE` 0 → 32, and the rebuilt lid landed where the preview showed it. Escape cancelled a drag and restored the lid.
  - **Demo viewer:** a drawer drag by a demo viewer stopped at the joint's 40 mm and showed "View only: not saved". It saved nothing (still 3 revisions), and Reset put the drawer back (`docs/images/workspace-move.png`).
  - **Part popover:** the lid's popover says `Attached to Base by "hinge" (revolute) · 32.0° (0.0–110.0°)`.
  - **Phone width:** at 390 px the explode slider wraps onto its own row, Move parts is hidden, and the page does not scroll sideways (`docs/images/workspace-explode-mobile.png`).
  - Checked in light and dark themes.
- **Viewer fix:** the export has no materials, and three.js then uses glTF's default, which is fully metallic. Faces turned away from the lights rendered black, which an opened lid made obvious. The viewer now uses half that metalness.
- **Agent summary:** the placements line (`Placements: Lid angle 0.0° (LID_ANGLE), Drawer travel 0.00 mm (DRAWER_OUT)`) and `inspect_get`'s `joints` section are covered by Worker tests. They were not exercised over a live MCP client.
- **Cost:** reading joints takes 0.47 ms on the box, whose whole record takes 0.042 s (34 faces, 10.6 KiB), measured on the Mac mini.
- **Known limits:**
  - The camera does not refit while exploding, so a far part can leave the frame until you zoom out.
  - Models without joints explode only along Z.
  - Dragging works on linear and revolute joints only, and only on desktop.

## Empty project with a connected agent — 2026-11-09

A teammate connected Claude's custom connector over MCP sign-in. Their app was listed in Settings and created a project, but the empty project still said "Start with your agent" and "Connect an agent", which read as if the connection had failed. The empty screen now loads the member's connected apps. When at least one is connected it says, for example, "Claude is connected. Ask it to build a model in “Bridge Tombstone”." Its connect button becomes the secondary "Add another agent". It falls back to the original wording while the list loads or if loading it fails. The Connect drawer now leads with adding the server URL and signing in, and keeps API keys for clients without sign-in.

- `src/web/empty.test.ts` covers no apps, an unknown list, one app, two apps, three or more, and one app signed in twice. Full `bash ci/run.sh` passed: 308 Worker tests and 84 Python tests with 11 skipped, plus format, types, build, audit and the Wrangler dry run.
- In the app (local `wrangler dev`): with no connected app, the empty project showed the original wording. A local client named "Claude" was registered and approved on the consent page, and its code was exchanged for tokens. Opening the project then showed "Claude is connected" (`docs/images/workspace-empty-connected.png`). After disconnecting it through the Settings API, the original wording returned.
- At 390 px there is no horizontal scroll and both buttons fit on one row (`docs/images/workspace-empty-connected-mobile.png`). Known limit, present before this change: with the activity panel open on a phone, its "Hide activity" toggle overlaps the empty screen's first button.

## API keys removed; MCP sign-in only — 2026-11-09

Every MCP client now connects through OAuth sign-in, so Mantel API keys (`mtl_…`) were removed. The **Settings → API keys** page, its `/api/settings/keys` routes, the `keys.use` permission and the `/mcp` key resolver are gone. Settings now has a **Connected apps** page with the existing connected-apps list. `0009_remove_api_keys.sql` deletes `keys.use` from levels and per-person adjustments and drops `api_keys`. Before the change, production had two keys, both already revoked; the last was used on 2026-11-05. The privacy policy was updated to match (effective 2026-11-09).

- Tests that called `/mcp` with keys now get tokens through the full OAuth flow (`mcpToken` in `src/server/test-helpers.ts`). New tests show that an `mtl_` key on `/mcp` gets a 401 pointing to sign-in, `/api/settings/keys` returns 404, and the migration leaves no `api_keys` table or `keys.use` grant. The accounts-migration test no longer checks the key rows it once produced, because a later migration drops them.
- Full `bash ci/run.sh` passed: 300 Worker tests and 84 Python tests with 11 skipped, plus format, types, build, audit and the Wrangler dry run.
- In the app (local `wrangler dev`, migration 0009 applied): Settings lists Account and Connected apps under "You", and the Connected apps page shows the server URL and the existing list (`docs/images/settings-connected-apps.png`). Access levels no longer lists an API keys permission. At 390 px there is no horizontal scroll (`docs/images/settings-connected-apps-mobile.png`).
- Known limit: a script or CI job can no longer call `/mcp` without a browser sign-in. Rolling back the Worker alone would not bring keys back, because the migration drops the table; D1 Time Travel can restore it.

## Copyable MCP setup instructions in Settings — 2026-11-09

**Settings → Connected apps** now opens with a **Set up your AI** panel. **Copy instructions** copies text a member pastes into their AI app. The text gives this site's `/mcp` URL, says sign-in is OAuth and there are no keys, and lists each client's own setup: the `claude mcp add` and `codex mcp add`/`codex mcp login` commands, Cursor/VS Code, and Claude's custom connector (which the member adds themselves). It warns that sign-in returns to the computer the AI runs on, then has the AI confirm with `projects_list` and read the modeling skill with `skills_list`. The workspace Connect drawer points to it.

- `src/web/setup.test.ts` checks the URL in every command, that the text never mentions keys or bearer tokens, and that it asks for the `projects_list` check. Full `bash ci/run.sh` passed: 310 Worker tests and 100 Python tests with 11 skipped, plus format, types, build, audit and the Wrangler dry run.
- The `claude mcp add` and `codex mcp add`/`login` flags were checked against the installed CLIs' `--help`.
- In the app (local `wrangler dev`): **Copy instructions** changed to "Copied" and back after about 2.5 seconds, with no error (`docs/images/settings-setup-prompt.png`). At 390 px there is no horizontal scroll (`docs/images/settings-setup-prompt-mobile.png`). Browsers may break a line after the hyphen in `--transport`; the copied text is unchanged.
- Not verified: pasting the instructions into an AI app and completing a sign-in from them.

## Enforced structure: design sheets, change plans and the guard — 2026-11-09

Branch `feat/enforced-structure`, implementing `docs/superpowers/plans/2026-11-09-enforced-structure.md` (Part 1 of the sequential editing design). Local evidence; not deployed.

- Agents previously rewrote whole scripts because nothing enforced the steps layout. Every save now passes the guard in `saveRevision`. An MCP write needs a design sheet and an open change plan of the same member, and while the framework is unbuilt it must use the steps layout with `base()` returning `None`, adding framework layers in order. Afterwards it may touch only the layers, `PARAMS` and shared code the plan declares. `src/server/design.test.ts` has one test per refusal, plus the Review Focus cases: no `sessionId` from the plan's member (accepted), another session (refused), a person's save during an agent plan (its own person change; the agent then gets the existing 409), a free-form legacy model (people can still change `PARAMS`; agents must `design_start` first), declared renames and moves (moving one layer is not an edit of its neighbours, and an adjacent swap is attributed to the declared layer), and whitespace-only churn (ignored; a changed comment counts as shared code).
- `src/server/migration-0010.test.ts` applies migrations up to 0009, fills `project_events` and `note_deliveries`, then applies 0010. Rows, their rowid order (which note delivery relies on) and the foreign key survive, the new `design` and `change` kinds are accepted and unknown kinds are not. Changing the copy to sort by id makes the test fail.
- "A tea cup is designed, built and changed through MCP" runs `session_start`, `models_create`, `design_start` with `examples/tea_cup_design.json`, the six framework layers with `change_progress` before each, then three changes (add a saucer, a thinner handle, a 110 mm `CUP_HEIGHT` with the wall and handle following). Every revision has a `change_id`, the four plans are finished, the change events come in order, and the last revision's layers are the framework plus Saucer.
- The engine gained `revolve`, `loft`, `sweep`, `shell` and `appearance` (`engine/tests/test_shapes.py`): analytic volumes within 1–2 %, `PARAMS` inside nested point lists, ordered loft sections, a handle that must touch its target, shell open faces that must belong to the target, and colour kept through later cuts. Shelling a flared loft failed with OCCT's rounded offset, so shell falls back to sharp offsets. The tea cup reference (`examples/tea_cup_steps.py`) builds every layer `ok` at 95 mm and at 110 mm, natively and inside the CAD image.
- Full `bash ci/run.sh` passed: 373 Worker tests and 120 Python tests with 11 skipped, plus format, types, build, audit and the Wrangler dry run. `docker build -f engine/Dockerfile -t deal-toy-cad:test .` and `bash ci/container-smoke.sh` passed.
- In the app (local `wrangler dev`, migration 0010 applied, a project seeded from the tea cup files): the menu reads "Design sheet · 1 assumed", and the drawer shows the request, each section with the assumed one marked, and the six layers. It fits at 1440 × 900 and 390 × 844 in both themes (`docs/images/design-sheet-{light,dark,mobile-light,mobile-dark}.png`). That run showed the new events as "undefined" failed rows in the activity list, so they now render as one line each (`docs/images/design-activity.png`). The screenshots came from headless Chrome, because the shared browser profile was in use; no real MCP client was connected for this record.
- Known limits: `appearance` colours whole parts, so a gold rim on a white cup needs the rim as its own part. Existing agent-built models, such as DigitalBridge and SpaceX, are free-form or keep geometry in `base()`. Agents cannot edit them until a `design_start` restructures them as layers; people's edits still work. Agents that do not follow the new skill get refusals, not silent saves. The on-canvas selector, layers panel and change timeline are not built yet.

How the catalog covers the features of the two saved deal-toy models, which the spec asks to check before restructuring them:

| Feature                        | Catalog coverage now                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Plinth (DigitalBridge, SpaceX) | `body` (box or rounded box), `fillet`/`chamfer` on its edges                                       |
| Reveal band around the plinth  | `body` twice and `combine` cut to make the band, then `combine` cut from the plinth: several steps |
| Arch ribs (DigitalBridge)      | `sweep` with a rectangle section along the arch's points                                           |
| Lattice tower (SpaceX)         | `sweep` per strut works, but there is no pattern action; dozens of struts still need a custom step |
| Logo inlays from SVG (both)    | Still needs a custom step: there is no SVG or outline import action                                |
| Lettering (both)               | `text` (engrave or emboss)                                                                         |
| Material colours per part      | `appearance` (whole parts)                                                                         |

## Inspection through a pointed tip — 2026-11-10

The SpaceX deal toy's revision 3 build (production, release `6002ef0`) succeeded but its inspection record held only `Inspection failed: Standard_ConstructionError: gp_Vec::Normalized() - vector has zero norm`, so the workspace showed no section, explode or face tools for it. The Starship nose is a spline revolved to a point on its axis. The thickness ray from the nose's flat base runs up that axis and hits the tip, and build123d's `find_intersection_points` evaluates the surface normal at every hit, which OCCT cannot do at a pole. Thickness now collects the hit points directly from `BRepIntCurveSurface_Inter` without normals. Draft sampling of curved faces had the same failure at the tip once a `PULL` is declared; it now skips sample points with no normal.

- A regression test revolves the same profile: the base reads its 16.5 mm thickness with no warnings, and draft reports the curved face from the remaining samples. It failed with the production error before the fix.
- The revision 3 source, inspected locally: before the fix it raised the production error; after it, 18 parts, 1,708 faces and 5 holes with no warnings in 9.3 s on the development host, and the Starship's base thickness reads 56.49 mm (40 mm barrel plus the 16.5 mm nose, less the 0.01 mm overlap).
- Full `bash ci/run.sh` passed: 412 Worker tests and 145 Python tests with 11 skipped, plus format, types, build, audit and the Wrangler dry run. The native container build and smoke test run in the PR's hosted checks.
- Known limit: a build's record is written once. Existing builds keep their failed record until the revision is built again.
