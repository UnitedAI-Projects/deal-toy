# Saved Actions, Presets and View-As-Of Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let custom Python steps be saved as described, versioned, reusable actions that are checked by a real build first; let people and agents save presets (named input sets) for any action; and let anyone view the model as it was after any step.

**Architecture:**

- **Saved actions.** A custom action is a decorated Python function, `@mt.action(...)`. Its record (summary, inputs, creates, example) is read from the decorator by the engine, so the code describes itself.
- **The check build.** `actions_save` stores the source with status `checking` and queues a check job. That job builds the model revision with the candidate loaded and its example appended. The action becomes `ready` only if that step is `ok` and creates every name it declares.
- **Pinned sources in builds.** Builds of scripts that use `m.custom(..., action="id@N")` carry the pinned sources of those actions.
- **View as of a step.** This is a preview-only job: GLB and facts, no STEP or STL, cached per revision and step.
- **Job kinds.** All three job kinds share the `jobs` table through a new `purpose` column.

**Tech Stack:** Cloudflare Workers, D1, Queues, TypeScript 7, zod 4, vitest with `@cloudflare/vitest-plugin`, React 19; engine Python 3.12, build123d 0.13.0, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-11-05-modeling-actions-design.md` (sections "Custom actions", "View as of a step", "What the agent always sees", goals 7, 8 and 10)

**Builds on:** `docs/superpowers/plans/2026-11-05-modeling-actions-core.md`, merged in #30.

## Global Constraints

- build123d stays at `0.13.0`; no new engine dependencies.
- Custom actions are Python that runs only in the build container, under the same limits as model scripts. Saving one never adds Worker code.
- A saved action joins the store only after its example builds with the step `ok` and every `creates` name present. The record keeps the revision it was validated on.
- Making an action or preset available to the whole team needs `settings.manage`. Otherwise it is project-scoped, and saving needs owner access to the project, `models.edit` and `builds.run`.
- A script pins `id@version`, so a revision rebuilds identically after a newer version is saved.
- Saved-action ids match `^[a-z][a-z0-9-]{1,39}$` and never equal a built-in action id.
- View-as-of jobs write no revision, count toward the daily build cap, and never appear as a revision's build.
- Every input of a saved action has a description, and its `summary` is at most 120 characters.
- Commit as `ichen27 <ivan27chen@gmail.com>`, with no AI attribution. The full check is `npm run check`.

## Review Focus

1. **Two saves of the same id at the same time:** the second gets `409 Action changed. Reload first`, never two rows with one version. Tested in Task 6.
2. **A script that uses a saved action the caller's project cannot see** (another project's project-scoped action): the build sends no source for it, and the step fails `action_not_found` instead of leaking it. Tested in Task 6.
3. **A check build whose candidate source has a syntax error, or no `@mt.action` decorator:** the action becomes `rejected` with a readable message, and the model's own revision builds are unaffected. Tested in Tasks 4 and 6.
4. **View-as-of for a step name that does not exist, or for a revision without a steps section:** the call is refused with 400 or 404 and queues nothing. Tested in Task 2.
5. **A preset whose inputs no longer validate after its action gains a new version:** using it in `steps_add` gives the normal validation message. It is never silently dropped. Tested in Task 7.

---

### Task 1: Job purposes and the new tables

**Files:**

- Create: `migrations/0005_saved_actions.sql`
- Modify: `src/server/tools.ts` (workspace jobs query, `models_set_parameter` facts query), `src/server/step-tools.ts` (`latestFacts`), `src/server/actions/summary.ts` (`modelContext`). Each gets `AND purpose='build'`.
- Test: `src/server/purpose.test.ts`

**Interfaces:**

- Produces the following SQL:

  ```sql
  ALTER TABLE jobs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'build' CHECK(purpose IN ('build','check','view'));
  ALTER TABLE jobs ADD COLUMN options TEXT;            -- JSON: {"stopAfter": n} or {"check": "id@v"}
  CREATE INDEX jobs_purpose ON jobs(revision_id, purpose, created_at);
  CREATE TABLE saved_actions (id TEXT NOT NULL, version INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('project','team')),
    project_id TEXT REFERENCES projects(id), status TEXT NOT NULL CHECK(status IN ('checking','ready','rejected')),
    record TEXT, source TEXT NOT NULL, error TEXT, revision_id TEXT NOT NULL REFERENCES revisions(id), job_id TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id, version));
  CREATE TABLE presets (id TEXT NOT NULL, version INTEGER NOT NULL, action TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL, inputs TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('project','team')),
    project_id TEXT REFERENCES projects(id), created_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id, version));
  ALTER TABLE sessions ADD COLUMN catalog_seen TEXT;  -- ISO time of the newest saved action/preset this session was told about
  ```

- [ ] **Step 1: Write the failing test** `purpose.test.ts`, which seeds a model with a succeeded `build` job and a newer succeeded `view` job whose facts differ:
  - `"workspace lists only revision builds"`: `projects_get` returns the build job, not the view job.
  - `"step health and the summary ignore view jobs"`: `steps_list().health` and the MCP `context` reflect the build job's facts.
  - `"models_set_parameter reads build facts"`: a parameter present only in the view job's facts is refused with `no built parameter`.
- [ ] **Step 2: Run** `npx vitest run src/server/purpose.test.ts`. Expected: FAIL (no `purpose` column).
- [ ] **Step 3: Write the migration and add the four `purpose='build'` filters.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Give jobs a purpose and add saved action and preset tables"`.

### Task 2: View as of a step (engine and Worker)

**Files:**

- Modify: `engine/runner.py` takes `--stop-after N` and `--preview`. `engine/service.py` accepts `stopAfter` (int ≥ 1) and `preview` (bool) in the payload; with `preview` it returns only `model.glb` and `facts.json`. `engine/lib/mantel/model.py` gets `mt.set_stop_after(n)`: steps after the nth are not run and not logged.
- Modify: `src/server/builds.ts`. `consume` reads `purpose`/`options`, sends `stopAfter` and `preview` for view jobs, and accepts 2 artifacts for them (4 otherwise).
- Create: `src/server/view-tools.ts`, with tool `builds_view_as_of`. Modify `tools.ts` to include it and add a `summarize` case.
- Modify: `src/server/tool-kit.ts`. `queueBuild(c, revisionId, purpose = "build", options?: object)` inserts `purpose` and `options`.
- Test: `engine/tests/test_mantel.py`, `engine/tests/test_engine.py` (service preview), `src/server/view.test.ts`

**Interfaces:**

- Produces `builds_view_as_of({ revisionId, step: string })`, read access plus `builds.run`. It returns `{ id, status }`, the job to poll with `builds_get`.
  - It resolves `step` to its 1-based index in that revision's steps.
  - It reuses an existing `view` job for the same revision and `stopAfter` that is `queued`, `running` or `succeeded`.
  - The project owner may queue one. A demo viewer may reuse an existing one but not queue a new one. _(Ruling candidate: matches measure jobs in PR #28.)_
- Facts of a view job carry `"stoppedAfter": n`, and `factsSchema` gains `stoppedAfter: z.number().int().positive().optional()`.

- [ ] **Step 1: Write the failing tests:**
  - **Engine:**
    - `test_stop_after_runs_only_the_first_steps`: on the deal-toy fixture with `set_stop_after(3)`, the log has 3 entries, the parts are Base, Coin and Block, and the volume includes the uncut coin cavity.
    - `test_service_preview_returns_glb_and_facts`: calls `execute(source, preview=True, stop_after=2)`, and the artifact names are `["model.glb", "facts.json"]`.
  - **Worker:**
    - `"queues one view job per revision and step"`: a second call returns the same id.
    - `"refuses unknown steps and free-form scripts"`: no job is created.
    - `"consume sends preview options and stores two artifacts"`: uses the mock container pattern from `workspace.test.ts`, asserting the posted body contains `"stopAfter":3,"preview":true`.
    - `"counts toward the build cap"`.
- [ ] **Step 2: Run** the engine and Worker tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `uv run --project engine pytest engine/tests -q` and `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "View a model as of any step"`.

### Task 3: View-as-of in the timeline

**Files:**

- Modify: `src/web/Timeline.tsx`, adding a "View as of this step" button in the step popover and an `onViewAsOf(step)` prop.
- Modify: `src/web/Workspace.tsx`:
  - holds `asOf: { step: string; jobId: string; glb?: string } | null`;
  - polls `builds_get` until the job finishes;
  - passes the view GLB's artifact id to `Viewer` while `asOf` is set;
  - shows a banner "Viewing as of step N · Back to latest";
  - clears `asOf` when the model or revision changes.
- Modify: `src/web/style.css`, adding `.asof-banner`.
- Test: `src/web/asof.test.ts`, for a pure helper `asOfLabel(steps, name)` (in `src/web/timeline-chips.ts`) that returns `As of step 3 of 7: Mount hole`.

- [ ] **Step 1: Write the failing test** for `asOfLabel`.
- [ ] **Step 2: Run** `npx vitest run src/web`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run typecheck` and `npm run build`.
- [ ] **Step 4: Verify in the app** with local `wrangler dev` and the CAD container. On the fixture, choose "View as of this step" on step 3. The coin cavity, text and fillet disappear from the view, the banner shows, and "Back to latest" restores the full model. Check at 390 px.
- [ ] **Step 5: Commit** `git commit -m "View the model as of a step from the timeline"`.

### Task 4: Self-describing custom actions in the engine

**Files:**

- Create: `engine/lib/mantel/saved.py`, containing `action` (the decorator), the input helpers, the registry and the loader.
- Modify: `engine/lib/mantel/__init__.py` to export them. Modify `engine/lib/mantel/actions/basics.py` so `custom` accepts `action="id@N"`.
- Modify: `engine/lib/mantel/catalog.json` through the generator. `custom` inputs become `fn` (`x-ref` `fn`) and `action` (string, 3–48 characters). Neither is required, and exactly one is checked in code. Add the failure codes `action_not_found` and `action_rejected`.
- Modify: `engine/runner.py`, which takes `--modules DIR` and `--check KEY`. `engine/service.py` accepts `modules: {key: source}` (at most 20, each at most 100 KB, keys matching `^[a-z][a-z0-9-]{1,39}@[0-9]{1,6}$`) and writes them read-only under `root/saved/`. It also accepts `check: key`.
- Test: `engine/tests/test_saved.py`

**Interfaces:**

- Produces (Python):

  ```python
  @mt.action(id="finger-notch", summary="...", inputs={"on": mt.Face("..."), "width": mt.Length("...", min=8, max=40)},
             creates={"notch": "..."}, example='m.custom("Lid notch", action="finger-notch@1", on=m.face("Lid", "front"), width=18)')
  def finger_notch(m, on, width): ...            # docstring becomes the record's description
  ```
  - **Input helpers.** `mt.Face`, `mt.Edges`, `mt.Plane` (face or datum), `mt.Part`, `mt.Length(desc, min=0.01, max=2000, default=None)`, `mt.Angle(desc, min=-360, max=360, default=None)`, `mt.Count(desc, min=1, max=1000, default=None)`, `mt.Text(desc, max_length=200, default=None)`, `mt.Choice(desc, options, default=None)` and `mt.Flag(desc, default=False)`. Each produces one catalog-subset JSON Schema property.
  - **`mt.load_saved(directory)`** executes each `<key>.py` and registers its decorated function under that key. The decorator's `id` must equal the key's id. Saved files run with the same sandbox as the script.
  - **`m.custom(name, action="finger-notch@2", **inputs)`** validates the inputs against the saved record. It fails `action_not_found` when the key was not loaded.
  - **`mt.check(key)`** turns on check mode. After the model's steps run, `m.result()` executes the record's example against `m`. Any `action="<id>@…"` in the example resolves to the candidate. It records `facts["check"] = {"record": {...}, "step": StepLog, "error"?: str}`. `record` holds `{id, title, category: "Custom", summary, description, inputs, selections, creates, failures, preview: "none", example}`, in the same shape as a built-in catalog record.
  - **Record errors** (empty or long summary, an undescribed input, an example that does not call this action, a missing decorator, or a source exception) set `check.error` and leave `step` absent. The model build still succeeds.

- [ ] **Step 1: Write the failing tests** in `test_saved.py`. Each writes a candidate module and a fixture model to `tmp_path`:
  - `test_decorator_builds_a_catalog_record`: the input helpers produce described properties, the docstring becomes the description, and the record passes the same keyword-subset check as the catalog (reuse `mantel.schema`).
  - `test_saved_action_runs_as_a_step`: a model whose step is `m.custom("Notch", action="finger-notch@1", ...)` gives state `ok` with created `["notch"]`.
  - `test_unknown_saved_action_fails_the_step`: gives `action_not_found`.
  - `test_saved_inputs_are_validated`: `width=500` gives `invalid_input` mentioning `width`.
  - `test_check_mode_runs_the_example`: `facts["check"]["step"]["state"] == "ok"`, and the record id is `finger-notch`.
  - `test_check_reports_bad_records`: a 130-character summary, an undescribed input, a missing decorator and a syntax error each set `check.error`, and the build still succeeds.
  - `test_service_writes_modules_read_only`: `execute(..., modules={...})` succeeds, and a module that tries to write into `saved/` fails its step.
- [ ] **Step 2: Run** `uv run --project engine pytest engine/tests/test_saved.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement**, and regenerate the catalog with the generator (kept in `engine/tools/gen_catalog.py`, moved from the scratchpad so the catalog can be regenerated from the repository).
- [ ] **Step 4: Run** the engine suite and ruff. Expected: PASS. Also run the suite in the CAD image, as Task 3 of the core plan did.
- [ ] **Step 5: Commit** `git commit -m "Let custom actions describe themselves and be loaded by version"`.

### Task 5: Worker validation for saved actions

**Files:**

- Create: `src/server/actions/saved.ts`, which loads visible saved actions and presets from D1.
- Modify: `src/server/actions/validate.ts`. `validateInputs(action, inputs, saved?: ActionRecord)` handles `custom`: exactly one of `fn` or `action`, `action` must be a key in `saved`, and the remaining inputs are validated against that record.
- Modify: `src/server/step-tools.ts`. For `custom` steps with `action`, `steps_add` and `steps_edit` load the record with `savedAction(c, projectId, key)` and pass it.
- Test: `src/server/actions/validate.test.ts`, `src/server/saved.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export type SavedAction = {
    key: string;
    id: string;
    version: number;
    scope: "project" | "team";
    record: ActionRecord;
    source: string;
  };
  export async function savedAction(
    c: Context,
    projectId: string,
    key: string,
  ): Promise<SavedAction>; // ready + (team or same project) else AppError(404, `No saved action ${key}`)
  export async function visibleSaved(
    c: Context,
    projectId: string | null,
  ): Promise<SavedAction[]>; // latest ready version per id
  export async function sourcesFor(
    env: Env,
    projectId: string,
    source: string,
  ): Promise<Record<string, string>>; // pinned keys used by the script's custom steps → sources, visible ones only
  ```
- [ ] **Step 1: Write the failing tests:**
  - **Validation:**
    - `custom` with both `fn` and `action`, or neither, is refused.
    - `action: "finger-notch@1"` with a record validates the other inputs: `width: 500` is refused with `width must be at most 40 mm`.
  - **Visibility:**
    - Another project's project-scoped action is not visible and gives 404 in `steps_add`.
    - A team action is visible everywhere.
    - `sourcesFor` returns only visible, ready, pinned keys.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Validate steps that use saved actions"`.

### Task 6: `actions_save` and check builds

**Files:**

- Modify: `src/server/builds.ts`:
  - `consume` sends `modules: await sourcesFor(...)` for every job.
  - For `check` jobs it also sends the candidate (`modules[key]` from `saved_actions`, even while `checking`) and `check: key`.
  - On completion of a `check` job it sets the action `ready` (storing the record and job id) or `rejected` (storing the error). The record must pass `actionRecordSchema` (zod), and the step must be `ok` with every `creates` key in `created`. A failed check build also sets the action `rejected`.
- Modify: `src/server/view-tools.ts`, renamed `src/server/saved-tools.ts`, which holds `builds_view_as_of`, `actions_save` and `actions_status`.
- Modify: `src/server/builds.ts`: in `factsSchema`, add an optional `check` object.
- Test: `src/server/saved.test.ts`

**Interfaces:**

- Produces `actions_save({ modelId, id, expectedVersion, source, scope?: "project" | "team" })`.
  - **Permissions:** write access, `models.edit` and `builds.run`, plus `settings.manage` for `team`.
  - **What it does:** inserts `(id, expectedVersion + 1)` with status `checking`, conditional on the max version equal to `expectedVersion`; otherwise `409 Action changed. Reload first`. It refuses built-in ids and source over 100 KB. It then queues a `check` job on the model's latest revision with `options {check: key}`.
  - **Returns** `{ key, status: "checking", job }`.
- Produces `actions_status({ key })`, read access. It returns `{ key, status, error?, record? }`.
- [ ] **Step 1: Write the failing tests** (mock container as in `workspace.test.ts`):
  - `"save queues a check build with the candidate"`: the posted body has `check: "finger-notch@1"` and `modules["finger-notch@1"]`.
  - `"a passing check makes the action ready"`.
  - `"a failing or erroring check rejects it"`.
  - `"a failed check build rejects it and leaves revision builds alone"`.
  - `"concurrent saves conflict"`.
  - `"team scope needs settings.manage"`.
  - `"builds send pinned sources only for visible actions"`.
  - `"built-in ids are refused"`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Save custom actions after a check build"`.

### Task 7: Presets

**Files:**

- Modify: `src/server/saved-tools.ts`, adding `presets_save` and `presets_list`. Modify `src/server/step-tools.ts` so `steps_add` gains `preset?: string` (a preset id).
- Modify: `src/server/actions/validate.ts`. `validatePartial(action, inputs)` checks each given input against its property, without required or conditional checks.
- Test: `src/server/presets.test.ts`

**Interfaces:**

- Produces:
  - `presets_save({ projectId, id, expectedVersion, action, name, description, inputs, scope? })`. The id matches `^[a-z][a-z0-9-]{1,39}$`, the name is at most 80 characters, and the description at most 500. The action is a built-in id or a visible saved key. Versioning works like `actions_save`.
  - `presets_list({ projectId?, action? })`, which returns the latest version of each visible preset.
  - `steps_add` with `preset` merges `{...preset.inputs, ...inputs}` and then runs full validation. Errors name the preset: `Preset m3-counterbore: cb_depth is required when kind is counterbore`.
- [ ] **Step 1: Write the failing tests:**
  - save and list;
  - partial validation refuses unknown keys and out-of-range values;
  - `steps_add` with a preset adds the merged inputs;
  - explicit inputs override the preset;
  - a preset that no longer validates gives the preset-named message (Review Focus 5);
  - visibility follows scope.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add presets for actions"`.

### Task 8: The catalog the agent sees includes saved actions and presets

**Files:**

- Modify: `src/server/step-tools.ts`:
  - `actions_list` gains `projectId?` and lists visible saved actions (category `Custom`, `id` = key) after the built-ins.
  - `actions_describe` accepts a saved key and returns its record plus `presets` for that action.
- Modify: `src/server/tools.ts`:
  - `session_start`'s `actions` adds the saved actions' index lines and a `Presets:` line.
  - In `dispatch`, for MCP calls with a `sessionId`, ready saved actions and presets visible to the session's project with `created_at > sessions.catalog_seen` are appended to `context` as lines like `New action finger-notch@2: <summary>` and `New preset m3-counterbore (hole): <description>`. Then `catalog_seen` is updated. At most 10 lines, followed by `(+N more; call actions_list)`.
- Test: `src/server/catalog-context.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `session_start` lists a ready saved action and a preset.
  - An action made ready during a session appears exactly once, in the next MCP result's context.
  - A rejected action never appears.
  - A project-scoped action from another project never appears.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Tell the agent about new saved actions and presets"`.

### Task 9: Skill, docs and an end-to-end check

**Files:**

- Modify: `skills/modeling/SKILL.md`, bumping the builtin version to 2.
  - How to write `@mt.action` with described inputs and an example.
  - Save with `actions_save`, then poll `actions_status`.
  - After it is `ready`, replace `fn=` calls with `action="id@N"` through `steps_edit`.
  - Use presets with `steps_add`'s `preset`.
  - Use `builds_view_as_of` to show the model at a step.
- Create: `examples/saved_actions/finger_notch.py`, a reference custom action, and add it to `examples/README.md`.
- Modify: `docs/validation.md` and `README.md`.
- Test: `engine/tests/test_saved.py::test_example_action_checks`, in which the example action passes check mode against `examples/deal_toy_steps.py`.

- [ ] **Step 1: Write the failing test**, then run it. Expected: FAIL.
- [ ] **Step 2: Add the example, then edit the skill and docs.**
- [ ] **Step 3: Check the whole loop in the app** with local `wrangler dev` and the CAD container:
  1. Save the example action through `/api/tools/actions_save`.
  2. Watch it become `ready`.
  3. Add it as a step with `steps_add`.
  4. See the step `ok` in the timeline.
  5. View the model as of step 2.

  Record the results in `docs/validation.md`.

- [ ] **Step 4: Run** `npm run check`. Expected: every stage passes.
- [ ] **Step 5: Commit** `git commit -m "Teach the skill saved actions, presets and view-as-of"`.

### Task 10: Review, PR and merge

- [ ] **Step 1: Review the whole branch** against this plan and the spec. Fix Critical and Important findings test-first.
- [ ] **Step 2: Push the branch and open the PR** "Saved actions, presets and view-as-of". The body covers the problem, the behaviour, the validation and the risks, with no AI attribution.
- [ ] **Step 3: Merge only after green:**
  ```bash
  gh pr checks <N> && gh pr merge <N> --squash --match-head-commit <sha>
  ```
  Then confirm `main` contains the commit, watch the Deploy run, and sync the local checkout.
