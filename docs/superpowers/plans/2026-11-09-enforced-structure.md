# Enforced Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can only change a model through a recorded design sheet and declared change plans, inside a steps-layout framework, with the catalog actions a tea cup needs.

**Architecture:** Two new D1 tables hold design sheets and change plans. New MCP tools (`design_start`, `design_get`, `change_begin`, `change_progress`, `change_finish`) write them. One guard inside `saveRevision` checks every agent (MCP) write against the sheet and the open plan. It decides ownership by comparing the old and new source in the Worker, without running Python. People's writes skip the guard and are recorded as finished person changes. The engine gains `revolve`, `loft`, `sweep`, `shell` and `appearance` actions, generated into the catalog the same way as the existing ten.

**Tech Stack:** Cloudflare Workers (TypeScript, zod, D1, vitest with `cloudflare:test`), Python 3.12, build123d/OCCT, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-11-09-sequential-editing-and-agent-presence-design.md`, Part 1. Parts 2–4 get their own plans after this one merges.

## Global Constraints

- Enforcement lives in the dispatcher and `saveRevision`, never only in skill text. Every refusal names what is missing and the tool to call. Every refusal path has a test.
- The guard applies to `channel === "mcp"` writes only. `http` and `internal` writes are people's or system writes and are never refused by it.
- Reserved layer name `Framework` means the model's `PARAMS`. No step may be named `Framework`.
- A plan closes as `stopped` when its session ends, or after **30 minutes** without activity (`STALE_MS = 30 * 60_000`). At most **one open plan per model**.
- In new framework layers, `base()` must be exactly `return None` (comments and a docstring allowed).
- Design sheet limits: 1–40 sections. Section name 1–80 characters, value 1–2000, source `answered` | `assumed`. Framework of 1–100 layers. Layer names 1–80 characters, unique. Region coordinates −2000 to 2000 mm, with `min < max` on every axis.
- Layer kinds: `shape`, `modify`, `size`, `appearance`, `construction`.
- Commit as `ichen27 <ivan27chen@gmail.com>`. No AI attribution anywhere.
- `bash ci/run.sh` passes before the PR, and `bash ci/container-smoke.sh` passes after the engine tasks.

## Review Focus

1. **The agent omits `sessionId` on step calls.** Most do. A write from the plan's own member is accepted without one. A write naming a _different_ session is refused. (Test in Task 5.)
2. **A person edits in the browser while an agent plan is open.** The person's save succeeds and is recorded as a person change, not attached to the agent's plan. The agent's next write gets the existing 409 conflict. (Task 5.)
3. **A legacy free-form model (SpaceX style, no steps section).** People can still change its `PARAMS` with no design sheet. An agent must `design_start` first, and its first write must be in the steps layout. (Task 5.)
4. **Rename and reorder under a plan.** `steps_rename` passes only if the plan declares `{from, to}` in `rename`. `steps_move` passes only if the moved layer is declared. Moving it must not count as editing the undeclared layers around it. (Tasks 2 and 5.)
5. **Whitespace-only churn outside the layers.** An agent that re-saves with different trailing whitespace or blank lines is not refused as a "shared code" change. A changed comment still counts. (Task 2.)

---

### Task 1: Tables for design sheets and change plans

**Files:**

- Create: `migrations/0009_design_and_changes.sql`
- Modify: `src/server/activity.ts:8-9` (`EventKind`)
- Modify: `src/server/tool-kit.ts:52-75` (`saveRevision` insert lists its columns)
- Test: `src/server/design.test.ts`

**Interfaces:**

- Produces:
  - Table `design_sheets(model_id TEXT PRIMARY KEY REFERENCES models(id), request TEXT NOT NULL, sections TEXT NOT NULL, framework TEXT NOT NULL, built INTEGER NOT NULL DEFAULT 0, session_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`. `sections` and `framework` are JSON.
  - Table `change_plans(id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES models(id), project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT, member TEXT NOT NULL, by_kind TEXT NOT NULL CHECK(by_kind IN ('agent','person')), framework INTEGER NOT NULL DEFAULT 0, request TEXT NOT NULL, layers TEXT NOT NULL, sections TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK(status IN ('open','finished','stopped')), current TEXT, phrases TEXT NOT NULL DEFAULT '[]', summary TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT)`.
  - Index `CREATE UNIQUE INDEX one_open_plan ON change_plans(model_id) WHERE status='open'`.
  - Column `revisions.change_id TEXT REFERENCES change_plans(id)`, nullable.
  - `project_events.kind` additionally allows `'design'` and `'change'`. Rebuild `project_events` and `note_deliveries` together, keeping their rows and indexes, using the rebuild pattern of `migrations/0008_checks.sql`.
  - `EventKind` gains `"design" | "change"`.

- [ ] **Step 1: Write the failing tests** in `src/server/design.test.ts` (`describe("design tables")`):
  - `"allows one open plan per model"`: insert two `status='open'` rows for one model; the second insert rejects with a UNIQUE error. A `finished` row next to an open one is accepted.
  - `"records design and change events"`: `recordEvent(c, {kind: "design", …})` and `kind: "change"` succeed.
  - `"keeps saving revisions"`: `models_save` through `execute` still returns `{id, number: 1}`, and the row's `change_id` is `null`.
- [ ] **Step 2: Run** `npx vitest run src/server/design.test.ts`. Expected: FAIL (no such table `change_plans`).
- [ ] **Step 3: Write the migration.** Change the `saveRevision` insert to `INSERT INTO revisions (id,model_id,number,source,created_at) SELECT ?,id,revision+1,?,? FROM models WHERE id=? AND revision=?`, and add the two kinds to `EventKind`.
- [ ] **Step 4: Run** `npx vitest run src/server/design.test.ts` and the full `npm test`. Expected: PASS, with existing note-delivery tests still green.
- [ ] **Step 5: Commit** `git add migrations/0009_design_and_changes.sql src/server/activity.ts src/server/tool-kit.ts src/server/design.test.ts && git commit -m "Add tables for design sheets and change plans"`.

### Task 2: Source ownership comparison

**Files:**

- Create: `src/server/design/ownership.ts`
- Test: `src/server/design/ownership.test.ts`

**Interfaces:**

- Consumes: `readSteps(source)` and `Step` from `src/server/actions/script.ts`.
- Produces:

```ts
export type SourceChange = {
  /** The after source has a parsable steps section. */
  layout: boolean;
  /** base() is exactly `return None` (comments/docstring allowed); "missing" when there is no base(). */
  base: "empty" | "code" | "missing";
  added: string[]; // layer names only in after
  removed: string[]; // layer names only in before
  edited: string[]; // layers whose statement changed, or whose fn= function changed
  moved: string[]; // layers whose position changed relative to the layers around them
  params: boolean; // the PARAMS literal changed
  shared: boolean; // any other top-level code, or build() outside the markers, changed
};
export function compareSources(
  before: string | null,
  after: string,
): SourceChange;
export function layerNames(source: string): string[] | null; // null when there is no steps section
```

Approach: split the module into top-level chunks. A chunk starts at any non-blank line in column 0 that is not a comment or a continuation. Key each chunk as follows: `def <name>` → `fn:<name>`, `def build` → `build` (with the steps section replaced by a placeholder), `def base` → `base`, `PARAMS = …` → `params`, anything else → `shared`. Compare chunks after stripping trailing whitespace on each line and collapsing runs of blank lines. A changed `fn:<name>` chunk counts as an edit of every layer whose inputs reference `{fn: name}` in either source. An unreferenced one sets `shared`. For `moved`, compute the longest common subsequence of shared layer names in order; names outside it are `moved`. `before === null` reports every layer as added.

- [ ] **Step 1: Write the failing tests.** Build sources with a small `script(steps, {base, params, extra})` helper like the one in `engine/tests/test_mantel.py`:
  - `"reports added, removed and edited layers"`: a changed `diameter` on "Mount hole" → `edited: ["Mount hole"]`, nothing else.
  - `"attributes a custom function to the layers that call it"`: changing `def notch` called by `m.custom("Notch", fn=notch)` → `edited: ["Notch"]`, `shared: false`. Changing an uncalled helper → `shared: true`.
  - `"flags PARAMS changes"`: a changed value → `params: true`, `shared: false`.
  - `"ignores trailing whitespace and blank-line churn but not comments"`: whitespace only → every field empty or false. A changed comment above `build` → `shared: true`.
  - `"detects base code"`: `return None` → `"empty"`. A docstring plus `return None` → `"empty"`. `return bd.Box(1,1,1)` → `"code"`. No `def base` → `"missing"`.
  - `"moving one layer reports only that layer"`: moving "Deal text" before "Mount hole" in the `deal_toy` fixture → `moved: ["Deal text"]`.
  - `"free-form scripts have no layout"`: `examples/bridge.py` → `layout: false`, `layerNames` → `null`.
- [ ] **Step 2: Run** `npx vitest run src/server/design/ownership.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `compareSources` and `layerNames` in `src/server/design/ownership.ts` as described above.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Compare model sources by layer ownership"` with both files.

### Task 3: Design sheet tools

**Files:**

- Create: `src/server/design/sheet.ts`, `src/server/design-tools.ts`
- Modify: `src/server/tools.ts:571-573` (spread `...designTools` into the registry)
- Test: `src/server/design.test.ts` (`describe("design_start")`)

**Interfaces:**

- Consumes: `define`, `now` from `tool-kit.ts`; `modelAccess`, `AppError`, `id` from `core.ts`; `recordEvent`, `sessionFor` from `activity.ts`.
- Produces:

```ts
// sheet.ts
export const RESERVED_LAYER = "Framework";
export type Region = {
  min: [number, number, number];
  max: [number, number, number];
};
export type Section = {
  name: string;
  value: string;
  source: "answered" | "assumed";
};
export type LayerKind =
  "shape" | "modify" | "size" | "appearance" | "construction";
export type FrameworkLayer = {
  name: string;
  kind: LayerKind;
  params: string[];
  region: Region;
};
export type DesignSheet = {
  modelId: string;
  request: string;
  sections: Section[];
  framework: FrameworkLayer[];
  built: boolean;
  createdAt: string;
  updatedAt: string;
};
export const sectionSchema: z.ZodType<Section>;
export const regionSchema: z.ZodType<Region>;
export const layerSchema: z.ZodType<FrameworkLayer>;
export async function sheetFor(
  c: Context,
  modelId: string,
): Promise<DesignSheet | null>;
export function mergeSections(
  current: Section[],
  updates: Section[],
): Section[]; // replace by name, append new
```

- Tool `design_start({modelId, request, sections, framework})` (permission `models.edit`) does four things:
  1. Stores the sheet.
  2. Opens the model's **framework plan**, a `change_plans` row with `framework=1`, `by_kind='agent'`, `layers={add: framework layers, edit:[], remove:[], rename:[], follow:[], shared:false}` and the sheet's request.
  3. Records a `design` event with `{modelId, request, assumed: [section names], framework: [layer names]}`.
  4. Returns `{sheet, planId}`.

  It refuses with 409 `"This model already has a design sheet; change it through change_begin."` when a sheet exists.

- Tool `design_get({modelId})` uses read access, like `steps_list`, and returns `{sheet}` or `{sheet: null}`.
- The tool descriptions tell the agent to question the person about every section first, and to mark guesses as `assumed`.

- [ ] **Step 1: Write the failing tests:**
  - `"stores the sheet and opens the framework plan"`: two sections (one `assumed`) and three layers → `design_get` returns them. One open `change_plans` row with `framework=1`. A `design` event whose `assumed` is the assumed section's name.
  - `"refuses an empty section value"`, `"refuses duplicate layer names"`, `"refuses the reserved name Framework"`, `"refuses a region whose min is not below max"`: each returns 400 naming the field.
  - `"refuses a second design sheet"`: 409 with the exact message above.
  - `"denies other members and demo viewers"`: another Maker gets 404, as for any unseen model. A Demo viewer gets 403 or 404 from `design_start`, and on a demo project `design_get` succeeds.
- [ ] **Step 2: Run** `npx vitest run src/server/design.test.ts -t design_start`. Expected: FAIL.
- [ ] **Step 3: Implement** `sheet.ts` and the two tools.
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add design sheets: design_start and design_get"`.

### Task 4: Change plan tools

**Files:**

- Create: `src/server/design/plans.ts`
- Modify: `src/server/design-tools.ts` (three tools); `src/server/tools.ts` (`session_end` stops the session's plans)
- Test: `src/server/design.test.ts` (`describe("change plans")`)

**Interfaces:**

- Consumes: `Section`, `Region`, `LayerKind`, `mergeSections`, `sheetFor` (Task 3).
- Produces:

```ts
export const STALE_MS = 30 * 60_000;
export type PlanLayers = {
  add: { name: string; kind: LayerKind; region: Region }[];
  edit: string[];
  remove: string[];
  rename: { from: string; to: string }[];
  follow: string[];
  shared: boolean;
};
export type ChangePlan = {
  id: string;
  modelId: string;
  projectId: string;
  sessionId: string | null;
  member: string;
  by: "agent" | "person";
  framework: boolean;
  request: string;
  layers: PlanLayers;
  sections: Section[];
  status: "open" | "finished" | "stopped";
  current: string | null;
  phrases: string[];
  summary: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
};
/** Closes a stale open plan (recording a `change` event of type "stopped"), then returns the open plan or null. */
export async function openPlan(
  c: Context,
  modelId: string,
): Promise<ChangePlan | null>;
export async function stopSessionPlans(
  c: Context,
  sessionId: string,
): Promise<number>;
/** Layer names the plan lets a write touch: add, edit, remove, both sides of rename; "Framework" if listed in edit. */
export function declared(layers: PlanLayers): Set<string>;
export async function touchPlan(c: Context, planId: string): Promise<void>; // bumps updated_at
```

- Tool `change_begin({modelId, request, add?, edit?, remove?, rename?, follow?, shared?, sections?})`:
  - Requires a design sheet: 400 `"This model has no design sheet. Question the person about every section, then call design_start."`.
  - At least one of add, edit, remove or rename must be non-empty: 400 `"A plan must add, edit, remove or rename at least one layer."`.
  - Any other open plan: 409 `"A change plan is already open for this model (started <startedAt> by <member>). Finish it with change_finish."`.
  - Applies `sections` to the sheet with `mergeSections`.
  - Records a `change` event `{type:"begin", planId, modelId, request, add, edit, remove, rename, follow}` and returns `{planId}`.
- Tool `change_progress({planId, layer, phrases?})`:
  - `layer` must be in `declared(layers)` or `follow`: 400 `"<layer> is not in this plan."`.
  - `phrases` holds 0–5 strings of 1–120 characters.
  - Sets `current` and `phrases`, touches the plan, and records `{type:"progress", planId, layer, phrases}`.
- Tool `change_finish({planId, summary})`:
  - `summary` is 1–2000 characters.
  - For a framework plan, every framework layer must exist in the latest revision: 400 `"The framework is not built yet: missing <names>."`. On success it sets `design_sheets.built=1`.
  - For other plans, it returns `{missing: [added layers not in the latest revision]}` without refusing.
  - Records `{type:"finish", planId, summary, missing}`.
- Every plan tool refuses a plan of another member (404) and a plan that is not open: 409 `"This plan is <status>."`, adding `" It stopped after 30 minutes without activity."` when stale.
- `session_end` calls `stopSessionPlans` before recording `ended`.

- [ ] **Step 1: Write the failing tests:**
  - `"opens, reports and finishes a plan"`: begin, then progress `"Handle"` with phrases, then finish. The events come in order `begin`, `progress`, `finish`, and the row's status is `finished`.
  - `"refuses a plan without a design sheet"`, `"refuses an empty plan"`, `"refuses a second open plan"`, `"refuses progress on an undeclared layer"`: exact messages above.
  - `"stops a plan after 30 minutes without activity"`: set `updated_at` to 31 minutes ago. `openPlan` returns null, the row is `stopped`, and `change_progress` gets the stale message.
  - `"session_end stops the session's open plans"`.
  - `"framework plan cannot finish before its layers exist"`, then `"finishing the framework plan marks the sheet built"`. Seed the latest revision from Task 8's tea cup example, or an inline steps-layout script with the same layer names.
  - `"merges section updates by name"`: change_begin with `sections:[{name:"Rim", value:"oval 86 x 72", source:"answered"}]` replaces Rim only.
- [ ] **Step 2: Run** `npx vitest run src/server/design.test.ts -t "change plans"`. Expected: FAIL.
- [ ] **Step 3: Implement** `plans.ts`, the three tools and the `session_end` change.
- [ ] **Step 4: Run** the same tests, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add change plans: begin, progress, finish and stopping"`.

### Task 5: Guard every agent write

**Files:**

- Create: `src/server/design/guard.ts`
- Modify: `src/server/tool-kit.ts` (`saveRevision` calls the guard and appends its statements to the batch)
- Modify: tool descriptions of `models_save`, `models_set_parameter` and the `steps_*` writes, to mention plans
- Test: `src/server/design.test.ts` (`describe("guard")`), using `dispatch(c, name, input, "mcp")` for agent writes and `"http"` for people

**Interfaces:**

- Consumes: `compareSources`, `layerNames` (Task 2); `sheetFor` (Task 3); `openPlan`, `declared`, `touchPlan`, `PlanLayers` (Task 4).
- Produces:

```ts
export type GuardResult = {
  changeId: string;
  /** Statements to run in saveRevision's batch, each conditional on the new revision existing. */
  statements: D1PreparedStatement[];
};
export async function guardWrite(
  c: Context,
  modelId: string,
  expectedRevision: number,
  source: string,
  revisionId: string,
  sessionId?: string,
): Promise<GuardResult>;
```

`saveRevision(c, modelId, expectedRevision, source, sessionId?)` passes its new `revisionId`, inserts `change_id`, and runs `statements` in the same batch. The person-change insert uses `INSERT … SELECT … WHERE EXISTS(SELECT 1 FROM revisions WHERE id=?)`, so a 409 leaves no row. The three call sites pass `i.sessionId`.

Rules for an `mcp` write, checked in this order:

1. No sheet: 400 `"This model has no design sheet. Question the person about every section, then call design_start before saving geometry."`
2. No open plan: 409 `"No change plan is open for this model. Call change_begin with the layers you will add, edit or remove."` (with the stale suffix from Task 4 when it just stopped).
3. The plan belongs to another member, or `sessionId` is given and differs from the plan's: 409 `"Another change plan is open for this model (started <startedAt> by <member>)."`
4. While the sheet is not built, three framework checks apply:
   - `layout` must be true: 400 `"Use the steps layout: import mantel as mt, base() returning None, and one action per line between the mantel:steps markers."`
   - `base` must be `"empty"`: 400 `"base() must return None; put geometry in layers."`
   - `layerNames(source)` must be framework names in framework order (a prefix-preserving subset): 400 `"Layers must come from the design sheet's framework, in order: <problem>."`
5. Otherwise, compare against the previous revision with `compareSources(previousSource, source)`:
   - `edited ∪ added ∪ removed ∪ moved` must be a subset of `declared(plan.layers)`: 400 `"This write changes layers the plan does not declare: <names>. Start a new plan that includes them."`
   - `params` requires `"Framework"` in `edit`: 400 `"This write changes PARAMS; declare the Framework layer in the plan's edit list."`
   - `shared` requires `layers.shared`: 400 `"This write changes shared code (imports, helpers or module constants). Declare shared: true in the plan."`
   - On a built sheet, a write with `base: "code"` is refused with rule 4's base message.

On success, touch the plan and return its id. For a non-`mcp` write, return a new person change: `by_kind='person'`, `status='finished'`, with `layers.edit` from the comparison, `request` from the tool name (for example `"Changed BLOCK_W"` from `models_set_parameter`'s event message, or `"Edited in the interface"`), and the member and times. No sheet is required.

- [ ] **Step 1: Write the failing tests**, one per rule and the Review Focus cases:
  - `"refuses agent geometry without a design sheet"`: `models_save` via `mcp`, rule 1 message.
  - `"refuses agent writes with no open plan"`: rule 2 message.
  - `"refuses free-form source for the framework"`, `"refuses code in base()"`, `"refuses layers outside the framework"`: rule 4 messages.
  - `"builds the framework one layer at a time"`: `steps_add` of the first two framework layers via `mcp` succeeds, and both revisions carry the plan's `change_id`.
  - `"refuses undeclared layer edits"`: plan `edit:["Rim"]`, then `steps_edit` "Handle" → rule 5 message naming Handle.
  - `"refuses PARAMS changes without Framework"`: `models_set_parameter` via `mcp`.
  - `"refuses undeclared shared code"`: `models_save` adding a helper `def` with no caller.
  - `"accepts declared renames and moves"`: plan `rename:[{from:"Rim",to:"Lip"}]` with `steps_rename` passes. Plan `edit:["Handle"]` with `steps_move` of Handle passes; moving Rim under that plan is refused.
  - `"accepts agent writes without a sessionId from the plan's member"`, and `"refuses writes naming another session"`.
  - `"records people's edits as person changes"`: `models_set_parameter` via `http` with no sheet → saved, a `change_plans` row with `by_kind='person'`, `status='finished'`, `layers.edit` containing `"Framework"`, and the revision's `change_id` set to it.
  - `"a person's save during an agent plan is its own change"`: the agent plan stays open, the person's revision points at the person change, and the agent's next `steps_edit` with the old `expectedRevision` gets 409 `"Model changed. Reload before saving."`
  - `"legacy free-form models still take people's parameter edits"`: the bridge example via `http` works. An agent `models_save` before `design_start` gets rule 1.
- [ ] **Step 2: Run** `npx vitest run src/server/design.test.ts -t guard`. Expected: FAIL.
- [ ] **Step 3: Implement** `guard.ts` and wire it into `saveRevision`.
- [ ] **Step 4: Run** the full `npm test`. Expected: PASS. Existing step tests use `http` or `internal` and must stay green unchanged; if one breaks, the guard is leaking into non-agent writes.
- [ ] **Step 5: Commit** `git commit -m "Refuse agent writes outside the design sheet and change plan"`.

### Task 6: Revolve, loft, sweep and shell actions

**Files:**

- Modify: `engine/tools/gen_catalog.py` (four action records)
- Create: `engine/lib/mantel/actions/shapes.py`
- Modify: `engine/lib/mantel/actions/__init__.py` (import `shapes`)
- Regenerate: `engine/lib/mantel/catalog.json`
- Modify: `src/server/actions/catalog.test.ts:76` (index length 10 → 15 once Task 7 lands; 14 after this task)
- Test: `engine/tests/test_shapes.py`

**Interfaces:**

- Consumes: `builtin`, `StepError` from `mantel.model`; `_join` and `_cut` semantics from `actions/features.py`. Import them, or move them to `geometry.py` if they are needed in both places.
- Produces catalog records (category, inputs) and the engine functions:
  - `revolve(m, name, profile, smooth=False, angle=360, at=None, operation="new", target=None)`. Category Create, preview `bodies`. `profile` is a list of 3–200 `[r, z]` points (r 0–1000, z −2000–2000), closed automatically and revolved about the vertical axis through `at`. `operation` is `new`, `join` or `cut`.
  - `loft(m, name, sections, ruled=False, at=None, operation="new", target=None)`. Category Create. `sections` is a list of 2–20 objects `{shape: circle|ellipse|rectangle|rounded_rectangle, z, diameter?, width?, length?, radius?}` with strictly increasing `z`, plus an `allOf` that makes each shape's sizes required.
  - `sweep(m, name, path, section="circle", diameter=None, width=None, length=None, smooth=True, operation="join", target=None)`. Category Create. `path` is a list of 2–200 3D points. `target` is required for join and cut.
  - `shell(m, name, target, thickness, open=None, inward=True)`. Category Modify. `target` is a part ref, `thickness` is 0.2–50 mm, and `open` lists 0–6 face refs.
  - Failures use the existing codes: `invalid_input`, `invalid_geometry`, `part_not_found`, `face_not_found`, `missed_target`.
  - Each record has a one-line summary of at most 120 characters, a description saying when not to use it, and an example using a tea cup.
  - `mt.P(...)` values inside `profile`, `sections` and `path` resolve like any other input.

- [ ] **Step 1: Write the failing tests** in `engine/tests/test_shapes.py`, using the `script`/`run`/`states` helpers from `test_mantel.py`:
  - `test_revolve_makes_a_cup_wall`: an L-shaped closed profile gives one part, state `ok`, and a volume within 1% of the analytic ring volume.
  - `test_revolve_profile_reads_params`: changing `CUP_H` in PARAMS changes the bounds' Z by the same amount.
  - `test_loft_oval_to_round`: ellipse 86×72 at z=95 to circle Ø62 at z=0 gives bounds X≈86 and Y≈72 at the top.
  - `test_loft_refuses_unordered_sections`: decreasing z → `failed`, code `invalid_input`.
  - `test_sweep_handle_joins_the_wall`: a C path touching the wall gives one part with more volume than the wall alone.
  - `test_sweep_missing_the_target_fails`: a path 50 mm away → `failed`, `missed_target`.
  - `test_shell_hollows_with_open_top`: a solid cylinder shelled 3 mm with the top open gives volume ≈ outer − inner, within 2%.
- [ ] **Step 2: Run** `uv run --project engine pytest engine/tests/test_shapes.py -q`. Expected: FAIL (unknown actions).
- [ ] **Step 3: Add the records, implement `shapes.py` and regenerate the catalog:** `python3 -I engine/tools/gen_catalog.py engine/lib/mantel/catalog.json && npx prettier --write engine/lib/mantel/catalog.json`.
- [ ] **Step 4: Run** the engine tests, `uv run --project engine ruff check engine examples` and `npx vitest run src/server/actions`. Expected: PASS. The validator accepts every new schema with no new keywords.
- [ ] **Step 5: Commit** `git commit -m "Add revolve, loft, sweep and shell actions"`.

### Task 7: Appearance action

**Files:**

- Modify: `engine/tools/gen_catalog.py`, `engine/lib/mantel/actions/shapes.py`, `engine/lib/mantel/model.py` (`Model.appearance` dict; `result()` applies it), `engine/runner.py:103` (part facts gain optional `color` and `finish`), `src/server/builds.ts:103-110` (facts schema accepts the optional fields), regenerated `catalog.json`
- Test: `engine/tests/test_shapes.py`, `src/server/builds.test.ts` (or the existing facts-schema test file)

**Interfaces:**

- Produces:
  - `appearance(m, name, target, color, finish="satin")`. Category Modify, preview `none`. `target` is a part ref, `color` is `[r, g, b]` with each value 0–1, and `finish` is `matte`, `satin`, `gloss` or `metallic`.
  - The engine stores `m.appearance[label] = (color, finish)`, so later booleans on the part keep it. `result()` sets `shape.color = bd.Color(*color)`.
  - Facts `parts[i]` gain `color: [r,g,b]` and `finish` when the part has an appearance.
  - Scope: part-level only. Face-level colour (a gold rim on a white cup body) needs the rim as its own part for now. Record this as a known limit in `docs/roadmap.md`.

- [ ] **Step 1: Write the failing tests:**
  - `test_appearance_survives_later_cuts`: set an appearance, then cut a hole. The facts part has `color` equal to the input and `finish` `"gloss"`, and the GLB export succeeds.
  - `test_appearance_unknown_part_fails`: `part_not_found`.
  - Worker: `"facts accept part colour and finish"` parses a facts object with them.
- [ ] **Step 2: Run both suites.** Expected: FAIL.
- [ ] **Step 3: Implement it and regenerate the catalog.** Set the catalog index test length to 15.
- [ ] **Step 4: Run both suites.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add an appearance action for part colour and finish"`.

### Task 8: Tea cup reference model

**Files:**

- Create: `examples/tea_cup_steps.py`, `examples/tea_cup_design.json`, and the exports under `examples/exports/tea_cup/` (STEP, STL, GLB, facts.json)
- Modify: `examples/README.md` (artifact index entries)
- Test: `engine/tests/test_shapes.py::test_tea_cup_example_builds`

**Interfaces:**

- Produces:
  - `tea_cup_design.json`: a valid `design_start` input with sections overall size, body shape, rim, handle, foot, colours and finish, and designs (one `assumed`). Its framework is `Cup wall` (revolve), `Foot ring` (revolve, join), `Rim` (fillet around top), `Handle` (sweep, join), `Glaze` (appearance), each with regions.
  - `tea_cup_steps.py`: those layers, in that order, in the steps layout with `base()` returning None. `PARAMS` holds `CUP_HEIGHT` 95, `RIM_DIAMETER` 84, `BASE_DIAMETER` 62 and `WALL` 3, all in mm with ranges.
  - Tasks 4, 5, 9, 10 and 11 use both files as fixtures.

- [ ] **Step 1: Write the failing test.** `test_tea_cup_example_builds` asserts:
  - every step is `ok`;
  - the part labels are `["Cup wall"]` (the joins merge into it);
  - the bounds' height is 95 ± 0.5;
  - setting `CUP_HEIGHT` to 110 gives 110 ± 0.5 and keeps every step `ok`;
  - every `tea_cup_design.json` framework name appears in `layerNames` order.
- [ ] **Step 2: Run** `uv run --project engine pytest engine/tests/test_shapes.py -k tea_cup -q`. Expected: FAIL.
- [ ] **Step 3: Write the example and design files.** Export them with `uv run --project engine python engine/runner.py examples/tea_cup_steps.py examples/exports/tea_cup`, or the export command `examples/README.md` documents for the other examples.
- [ ] **Step 4: Run** the test and open the GLB once to check it looks like a cup. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add a tea cup reference model and design sheet"`.

### Task 9: Show the design sheet in the workspace

**Files:**

- Create: `src/web/DesignSheet.tsx`, `src/web/design-sheet.ts` (pure helpers) and `src/web/design-sheet.test.ts`
- Modify: `src/web/Workspace.tsx` (a "Design sheet" entry in the workspace menu, next to the manufacturing documents, opening a drawer)

**Interfaces:**

- Consumes: `design_get` (Task 3) through `call("design_get", {modelId})` from `src/web/api.ts`.
- Produces: `sheetRows(sheet: DesignSheet): {name: string; value: string; assumed: boolean}[]`, sorted in sheet order, and `assumedCount(sheet): number`.
- The drawer is read only. It shows the request quote, then one row per section with an "assumed" badge, then the framework layer names. The menu entry shows "Design sheet · 2 assumed" when there are assumptions. With no sheet, the entry reads "No design sheet yet" and is disabled. Demo viewers see it too, since it carries no source.

- [ ] **Step 1: Write the failing tests:** `"rows keep sheet order and mark assumptions"` and `"counts assumed sections"`.
- [ ] **Step 2: Run** `npx vitest run src/web/design-sheet.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, the drawer and the menu entry, reusing the existing drawer and badge styles in `style.css`.
- [ ] **Step 4: Run** the tests and `npm run build`. Then check the drawer at desktop (1440×900) and phone (390×844) sizes, in light and dark themes, on a local project seeded from `tea_cup_design.json`. Save the four screenshots as `docs/images/design-sheet-{light,dark,mobile-light,mobile-dark}.png`.
- [ ] **Step 5: Commit** `git commit -m "Show a model's design sheet in the workspace"` with the screenshots.

### Task 10: Skill, connection instructions and architecture notes

**Files:**

- Modify: `skills/modeling/SKILL.md`, `README.md` ("Connect an agent" sequence and status paragraph), `docs/architecture.md` (new "Design sheets and change plans" section), `docs/roadmap.md` (part-level colour limit; Parts 2–4 as next)
- Test: `src/server/design.test.ts` (`describe("modeling skill")`)

**Interfaces:**

- Consumes: the tool names from Tasks 3 and 4, and the example files from Task 8.
- The skill must say, in this order:
  1. Question the person in your own client about every section before any geometry tool. Record guesses as `assumed`.
  2. Call `design_start`.
  3. Build the framework layer by layer with `steps_add`, calling `change_progress` before each.
  4. Call `change_finish`.
  5. For each later request: `change_begin` with the layers to add, edit, remove or rename, and the ones that follow along; `change_progress` per layer; `change_finish` with a summary listing assumptions still unconfirmed.
  6. For a legacy free-form model, the first change is a restructure through `design_start`.

  It names `examples/tea_cup_steps.py` and `examples/tea_cup_design.json` as references, and says that refusals explain what to call next.

- [ ] **Step 1: Write the failing test.** `"every tool the modeling skill names is registered"` extracts backticked `snake_case` names matching registry tool names from `skills/modeling/SKILL.md`. It asserts that each one exists in `tools` and that `design_start`, `change_begin`, `change_progress` and `change_finish` all appear.
- [ ] **Step 2: Run it.** Expected: FAIL (the skill does not mention them yet).
- [ ] **Step 3: Rewrite the skill and update the three docs.**
- [ ] **Step 4: Run** `npx vitest run src/server/design.test.ts -t "modeling skill"` and `npm run format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Teach agents the design sheet and change plan flow"`.

### Task 11: End-to-end flow, validation record and PR

**Files:**

- Test: `src/server/design.test.ts` (`describe("tea cup end to end")`)
- Modify: `docs/validation.md`

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Write the test** `"a tea cup is designed, built and changed through MCP"`. Everything goes through `dispatch(…, "mcp")`, with build facts seeded from `examples/exports/tea_cup/facts.json` the way `steps.test.ts` seeds facts:
  1. `session_start`, `models_create`, then `design_start` with `tea_cup_design.json`.
  2. `steps_add` for each framework layer, with `change_progress` before each, then `change_finish`. The sheet is built.
  3. A change that adds a layer ("Saucer": `change_begin` add, then `steps_add`, then `change_finish`).
  4. A one-layer edit ("Handle").
  5. A size change (`edit:["Framework"]`, `follow:["Cup wall","Handle"]`, then `models_set_parameter`).

  Assert:
  - every revision has a `change_id`;
  - there are 4 plans, all `finished`;
  - the `change` events come in order;
  - the step layers of the last revision equal the framework plus "Saucer".

- [ ] **Step 2: Run** `bash ci/run.sh`, then `docker build -f engine/Dockerfile -t deal-toy-cad:test . && bash ci/container-smoke.sh`. Expected: all pass. Record the output summaries in `docs/validation.md` under a dated "Enforced structure" section, with the test counts and any limits found (part-level colour). Add a short table of the DigitalBridge and SpaceX features (plinth with reveal band, arch ribs, lattice tower, logo inlays, lettering): for each, which catalog action now covers it, or "still needs a custom step". The spec asks for the deal-toy examples to be checked against the catalog.
- [ ] **Step 3: Commit** `git commit -m "Record enforced-structure validation"`, push the branch, and open a PR. The PR body states the problem (whole rewrites, unenforced skill), the behaviour now (refusals, plans, new actions), the validation, and the risks:
  - existing agents must follow the new flow;
  - legacy models need a restructure before agent edits;
  - colour is part-level only.
- [ ] **Step 4: Review the diff, resolve findings,** and merge only after the current revision's checks pass (`gh pr checks <n> --watch && gh pr merge <n> --squash`). Deployment follows the repository's separate release workflow. Report pushed, merged and deployed as separate states.
