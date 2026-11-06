# Modeling Actions (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first ten self-describing modeling actions end to end for the agent: a described catalog, a `mantel` helper library in the engine that runs named steps with per-step health, Worker tools that edit the script's steps section, an always-on model summary in MCP results, and a read-only timeline in the viewer.

**Architecture:** One catalog file, `engine/lib/mantel/catalog.json`, defines every built-in action (description, JSON Schema inputs, created names, failure codes, preview primitive, example). The engine image bundles it with the `mantel` library, which executes `m.<action>("Name", ...)` calls and records each step's state in `facts.json`. The Worker imports the same JSON to describe and validate actions, and edits only the `# mantel:steps begin` … `# mantel:steps end` section through a restricted-grammar parser, saving revisions through the existing conflict check.

**Tech Stack:** Cloudflare Workers + D1 + Queues, TypeScript 7, zod 4, vitest with `@cloudflare/vitest-plugin`, React 19 + three.js viewer; engine Python 3.12, build123d 0.13.0, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-11-05-modeling-actions-design.md` (PR #29)

**Scope of this plan.** The spec is delivered in three plans:

1. **This plan (core):** catalog, engine library and batch-1 actions, step states and incomplete builds, step-section editing, `actions_*` and `steps_*` tools, the agent's catalog index and model summary, the skill update, and a read-only timeline with a suppress toggle. Custom steps here use only `fn=` (an unsaved function in the same script).
2. **Saved actions:** `actions_save` with example-build validation, D1 storage and scopes, pinned custom-action sources in build input, presets, catalog-change lines in tool results, and `builds_view_as_of`.
3. **Interface:** toolbar, generated forms, pick-to-fill references, ghost previews, timeline reordering, and the person's selection in the model summary. This needs face picking from inspect batch 1 (PR #28) first.

## Global Constraints

- build123d stays pinned at `0.13.0`; no new Python runtime dependencies in the engine (`dependencies = ["build123d==0.13.0"]`).
- Every catalog property has a `description`; every numeric property has a `unit` and a range; `summary` is at most 120 characters.
- Step edits change only bytes between `# mantel:steps begin` and `# mantel:steps end`; anything outside the grammar is refused with "ask the agent to tidy the steps section".
- References never use build face indices. A reference that does not resolve fails its step with `face_not_found` or `ambiguous_reference`; it never falls back to another face.
- Step states are exactly `ok`, `warning`, `failed`, `blocked`, `suppressed` from the engine; `pending` exists only in the viewer.
- A build with any `failed` or `blocked` step still produces artifacts and sets `"incomplete": true` in facts. An error outside the steps (in `base()` or the script) fails the build as today.
- The model summary is at most 1,500 characters.
- Step writes need the same permissions as `models_set_parameter` (`models.edit`, `builds.run`) and owner access to the project; reads need read access (demo projects work).
- Units are millimetres, Z up. Source never enters the activity log.
- Commit as `ichen27 <ivan27chen@gmail.com>`, no AI attribution anywhere.
- Full check: `npm run check` (format, typecheck, vitest, build, audit, ruff, pytest, wrangler dry run).

## Review Focus

1. **A step name containing quotes, `#`, backslashes or non-ASCII text** (for example the engraved text `ACME × "GLOBEX" #1`): render → parse must round-trip exactly and the comment scanner must not treat `#` inside strings as a comment. Test in Task 4.
2. **A script whose markers appear inside a string or a comment, twice, or out of order:** refuse rather than edit the wrong region. Test in Task 4.
3. **Renaming or removing a step that later steps reference:** rename rewrites `of="Old"` references in later steps; remove leaves them and the build reports `blocked`. Test in Task 5.
4. **A parameter change that leaves a query reference with two equally near candidates:** the step fails `ambiguous_reference` instead of picking one. Test in Task 3.
5. **A model summary for a model with 30+ steps, long names and many parameters:** truncates by dropping the oldest `ok` steps first, never the failed ones, and stays at most 1,500 characters. Test in Task 7.

---

### Task 1: Catalog file and its contract

**Files:**

- Create: `engine/lib/mantel/catalog.json`
- Create: `src/server/actions/catalog.ts`
- Test: `src/server/actions/catalog.test.ts`
- Modify: `tsconfig.server.json` (enable `resolveJsonModule` if not already on)

**Interfaces:**

- Produces (TS):
  ```ts
  export type ActionRecord = {
    id: string;
    version: number;
    title: string;
    category:
      "Create" | "Modify" | "Construct" | "Combine" | "Arrange" | "Custom";
    summary: string;
    description: string;
    inputs: JsonSchemaObject; // subset defined in Task 4's validator
    selections: {
      input: string;
      kind: "face" | "edge" | "plane" | "point" | "part";
      min: number;
      max: number;
    }[];
    creates: Record<string, string>; // created name -> description
    failures: { code: string; explanation: string; fix: string }[];
    preview: "plane" | "cylinder" | "prism" | "text" | "bodies" | "none";
    example: string; // one Python statement in step grammar
  };
  export type StepLog = {
    name: string;
    action: string;
    version: number;
    state: "ok" | "warning" | "failed" | "blocked" | "suppressed";
    code?: string;
    message?: string;
    created: string[];
    ms: number;
  };
  export type StepStateRecord = {
    state: "ok" | "warning" | "failed" | "blocked" | "suppressed" | "pending";
    meaning: string;
  };
  export const actions: ActionRecord[];
  export const stepStates: StepStateRecord[];
  export function getAction(id: string): ActionRecord; // AppError(404, `Unknown action ${id}`)
  export function catalogIndex(): string; // one line per action: `${id}@${version}: ${summary}`
  ```
- File shape: `{ "version": 1, "states": StepStateRecord[], "actions": ActionRecord[] }`.

- [ ] **Step 1: Write the failing test** `catalog.test.ts`:
  - `it("has the ten batch-1 actions")`: `actions.map(a => a.id)` equals `["body","plane","extrude","hole","fillet","chamfer","text","combine","move","custom"]`.
  - `it("describes every input")`: walking each `inputs` schema (including `oneOf` branches and array `items`), every property has a non-empty `description`; every `type: "number"` has `unit` and both `minimum` and `maximum`.
  - `it("keeps summaries short")`: every `summary.length <= 120`.
  - `it("names failures")`: every action has ≥1 failure; `face_not_found` and `ambiguous_reference` exist on every action with a face/edge selection; codes match `/^[a-z_]+$/`.
  - `it("lists the step states")`: `stepStates.map(s => s.state)` equals `["ok","warning","failed","blocked","suppressed","pending"]`.
  - `it("indexes the catalog")`: `catalogIndex().split("\n")` has 10 lines, the 4th is `hole@1: ` + hole's summary.
- [ ] **Step 2: Run** `npx vitest run src/server/actions/catalog.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Write `catalog.json`** with the ten actions and inputs from the spec's "Default actions" table:
  - `body`: `shape` enum box, rounded_box, cylinder, cone, sphere; `size` (array of 3 numbers 0.1–2000 mm); `radius` for rounded_box; `at` (point ref or `[x,y,z]`). Creates the sides `top`, `bottom`, `left`, `right`, `front`, `back`. The step name becomes the part label.
  - `plane`: `oneOf` on `method`, which is one of `offset` (`from` face/plane ref, `distance` −2000–2000 mm), `angle` (`about` edge ref, `from` face ref, `angle` −180–180 deg), `midplane` (`between` two face refs) or `three_points`.
  - `extrude`: `on` face/plane ref; `profile` `oneOf` `shape` = rectangle, rounded_rectangle, circle, slot, polygon; `extent` `oneOf` distance, symmetric or up_to (face ref); `taper` −45–45 deg; `operation` new, join or cut; `target` part ref for join/cut.
  - `hole`: `on` face ref; `kind` `oneOf` simple, counterbore (`cb_diameter`, `cb_depth`) or countersink (`cs_diameter`, `cs_angle` 60–120 deg); `diameter` 0.2–200 mm; `position` `oneOf` point (`at` 2-vector on the face), edges (two edge refs plus offsets) or centre; `depth` `oneOf` distance, through or up_to. Creates `wall`, `floor`, `counterbore_wall` and `countersink`.
  - `fillet` and `chamfer`: `edges` edge ref; `radius`, or `distance` with optional `angle`.
  - `text`: `on` face ref; `text` 1–200 characters; `font` enum from the image's installed fonts (`Liberation Sans`, `Liberation Serif`, `Liberation Mono` plus their bold forms); `height` 0.5–200 mm; `mode` engrave or emboss; `depth` 0.05–20 mm; `align` enum; `offset` 2-vector. Creates `text_faces`.
  - `combine`: `target` part ref; `tool` part ref; `operation` join, cut or intersect; `keep_tool` boolean.
  - `move`: `part` part ref; `method` is translate (`by`), rotate (`axis` enum X, Y or Z or an edge ref, `angle`, `origin`) or align (`face` → `to` face, `offset`).
  - `custom`: `fn` function ref, plus any further keyword arguments, which are passed to the function (the schema sets `additionalProperties: true` for this action only).

  Each action gets a description of when to use it and when not to (for example, the hole description says to use `combine` cut for non-round cavities), failures with a plain explanation and fix, a `preview` and an example statement. Write the `states` meanings as in the spec's step-state table.

- [ ] **Step 4: Implement `catalog.ts`**: import the JSON (`import data from "../../../engine/lib/mantel/catalog.json"`), export the typed arrays and the two functions.
- [ ] **Step 5: Run** the test. Expected: PASS. Then run `npm run typecheck`. Expected: no errors.
- [ ] **Step 6: Commit** `git commit -m "Add the modeling action catalog"`.

### Task 2: `mantel` engine library, references, and the `body`, `plane` and `custom` actions

**Files:**

- Create: `engine/lib/mantel/__init__.py`, `engine/lib/mantel/model.py`, `engine/lib/mantel/refs.py`, `engine/lib/mantel/actions/__init__.py`, `engine/lib/mantel/actions/body.py`, `engine/lib/mantel/actions/plane.py`, `engine/lib/mantel/actions/custom.py`
- Create: `engine/tests/test_mantel.py`
- Modify: `engine/runner.py` to put `lib` on `sys.path` and add the `steps` and `incomplete` facts
- Modify: `engine/Dockerfile` to `COPY engine/lib ./lib`

**Interfaces:**

- Produces (Python, `import mantel as mt`):
  - **Model:**
    - `mt.Model(base: bd.Shape | None, params: dict | None = None)`.
    - One method per catalog action: `m.<id>(name: str, *, suppressed: bool = False, **inputs) -> None`. An action without an engine module yet fails its step with `internal_error` "not implemented"; Task 3 removes that path.
    - `m.result() -> bd.Compound`, with the labelled parts as children.
    - `m.log -> list[StepLog]`.
  - **References:** `m.face(of: str, name: str | None = None, *, normal=None, near=None)`, `m.edges(of: str, *, between: tuple[str, str] | None = None, around: str | None = None)`, `m.datum(name: str)`, `m.point(x, y, z)`, `m.part(label: str)` and `mt.P(name: str)`. Each returns a lazy reference object that is resolved when the step using it runs.
  - **Registration:** `@builtin("<id>")` registers an action function `(model, name, **inputs) -> dict[str, Signature]`, where `Signature` is the geometric signature of each created name.
  - **Errors:** `mt.StepError(code: str, message: str)` for known failures. `mt.StepWarning(message: str)` is raised after the action finishes its own change, to mark the step as `warning`.
  - **`mt.last_log() -> list[StepLog] | None`**, which the runner reads after `build()`.
  - **The `StepLog` entry:** `{"name", "action", "version", "state", "code"?, "message"?, "created": [str], "ms": int}`.
  - **Facts additions:** `"steps": [...]` and `"incomplete": bool`, present only when the script used `mt.Model`.
  - **Custom steps:** `m.custom(name, fn=<function>, **kwargs)` calls `fn(m, **kwargs)`. A dict returned by the function is that step's created names.

**Behaviour the tests pin:**

- **Names.** `of` resolves first to a step name with created names, then to a part label with sides:
  - `top` and `bottom` are the extreme planar faces along +Z and −Z.
  - `left` and `right` are the extreme planar faces along −X and +X.
  - `front` and `back` are the extreme planar faces along −Y and +Y.

  A step whose name is already used fails with `duplicate_name`.

- **Created names store a geometric signature** when the step runs: the surface type, the plane normal and offset or the cylinder axis and radius, and the centroid. A later lookup matches the owning part's current faces by signature, within 0.01 mm and 0.5°. A face that later steps split into several faces resolves to all of them.
- **Query refs** (`normal=`, `near=`) pick the face on the part whose normal is within 1° and whose centroid is nearest `near`. If the second-nearest candidate is within 0.5 mm of the nearest, the step fails with `ambiguous_reference`.
- **Blocked steps.** A reference to a name created by a failed or suppressed step makes its step `blocked`, and the message names the upstream step.
- **Unexpected exceptions** inside an action become `failed` with code `internal_error` and the first 300 characters of the message. The model state rolls back to before that step.

- [ ] **Step 1: Write the failing tests** in `test_mantel.py`, using small inline scripts in the standard layout:
  - `test_body_and_plane_steps_ok`: a `body "Block"` box and a `plane "Mid plane"` midplane between Block's left and right sides. Both steps are `ok`, `incomplete is False`, the parts are `["Block"]`, and Block has all six sides.
  - `test_missing_face_fails_without_drift`: a plane offset from `m.face("Block", normal=(1, 1, 0), near=(0, 0, 0))` is `failed` with `face_not_found`, and the volume equals that of the same script without the step.
  - `test_ambiguous_query_fails`: a `body "Block"` box, then a `custom` `fn=` that unions an identical box into Block beside it, separated by a 10 mm gap. A plane offset from `m.face("Block", normal=(0, 0, 1), near=<the point midway between the two top faces>)` gives `ambiguous_reference`.
  - `test_blocked_and_suppressed`: suppressing `Mid plane` gives `suppressed`. A plane offset from `m.datum("Mid plane")` is then `blocked`, its message contains `"Mid plane"`, and `incomplete` is `True`.
  - `test_duplicate_name_fails`: of two steps named `"Block"`, the second is `duplicate_name`.
  - `test_custom_fn_runs_and_errors_roll_back`: an `fn=` that adds a box gives `ok`. An `fn=` that raises `RuntimeError("boom")` gives `failed` with `internal_error` and message `"boom"`; the model volume is unchanged and later steps still run.
  - `test_free_script_has_no_steps_facts`: the facts for `examples/bridge.py` have no `steps` key.
- [ ] **Step 2: Run** `uv run --project engine pytest engine/tests/test_mantel.py -q`. Expected: FAIL (`No module named 'mantel'`).
- [ ] **Step 3: Implement** `refs.py` (lazy refs and signature matching), `model.py` (`Model`, the step runner with `try` and rollback, the log, and `last_log` registration in `result()`) and the three action modules. In `runner.py`, call `sys.path.insert(0, str(Path(__file__).with_name("lib")))` before loading the user module. After `build()`, add `steps` and `incomplete` from `mantel.last_log()` when it is not `None`.
- [ ] **Step 4: Run** `uv run --project engine pytest engine/tests -q` and `uv run --project engine ruff check engine`. Expected: all pass, including the existing `test_engine.py`.
- [ ] **Step 5: Verify the image.** Run `docker build -f engine/Dockerfile .`, then `docker run --rm --read-only <image> /opt/cad/.venv/bin/python -I -c "import sys; sys.path.insert(0,'/opt/cad/lib'); import mantel"`. Expected: exit 0. If Docker isn't available on the host, say so and rely on the CI wrangler dry run plus Task 9's in-app check.
- [ ] **Step 6: Commit** `git commit -m "Add the mantel step library with body, plane and custom"`.

### Task 3: The remaining batch-1 actions and the deal-toy fixture

**Files:**

- Create: under `engine/lib/mantel/actions/`, `extrude.py`, `hole.py`, `edges.py` (fillet and chamfer), `text.py`, `combine.py` and `move.py`
- Create: `engine/tests/fixtures/deal_toy.py`
- Modify: `engine/tests/test_mantel.py`

**Interfaces:**

- Consumes: `@builtin`, `Signature`, `StepError`, `StepWarning` and the refs from Task 2.
- Produces: implementations for every catalog action, so the "not implemented" path from Task 2 is deleted. Also the fixture, which Tasks 4, 6 and 8 copy.

- [ ] **Step 1: Write the fixture** `fixtures/deal_toy.py` in the spec's standard layout:
  - **Parameters:** `BLOCK_W` 80 (40–150), `HOLE_D` 5 (2–10) and `HOLE_X` 20 (10–40).
  - **`base()`** returns a labelled `Base` (box 100×40×10) and a labelled `Coin` (cylinder of diameter 30 and height 3, inside the block's volume).
  - **Steps, in order:**
    1. `body "Block"`.
    2. `plane "Mid plane"`.
    3. `hole "Mount hole"` on Base bottom at (−30, 0), through all, diameter `mt.P("HOLE_D")`.
    4. `hole "Mount hole 2"` at (`HOLE_X`, 0), with the X position set as `mt.P("HOLE_X")`.
    5. `text "Deal text"`: `"ACME × GLOBEX"`, engraved 0.5 mm on Base front.
    6. `combine "Coin cavity"`: cut Coin from Block, keeping the tool.
    7. `fillet "Block edges"`: edges around Block top, radius 2.
- [ ] **Step 2: Write the failing tests:**
  - `test_fixture_builds_every_step_ok`: all 7 steps are `ok`, `incomplete is False`, and the parts are `["Base", "Coin", "Block"]`.
  - `test_each_catalog_example_builds`: for each catalog action except `custom`, the fixture's `base()` plus that action's `example` builds with the step `ok`. Its `created` list is a subset of the catalog's `creates` keys, and is non-empty when `creates` is non-empty.
  - `test_references_survive_param_changes`: build with `BLOCK_W` in {40, 80, 150} and `HOLE_D` in {2, 10}. In every case, the exported STEP has a through cylinder of diameter `HOLE_D` whose axis is at (−30, 0) on Base.
  - `test_ambiguity_after_param_change`: add a step that references a face query on Base, with `near` placed at x = −5, between the two hole positions. With `HOLE_X=20` it resolves to `Mount hole 2`'s wall, which is nearer. With `HOLE_X=30` the two holes sit symmetric about `near`, and the step is `ambiguous_reference`. Only the parameter may change between the two builds. The builder chooses the exact query.
  - `test_fillet_radius_clamped_warns`: a fillet of radius 50 on Block edges gives `warning`, and the build succeeds.
  - `test_hole_variants`: counterbore and countersink holes create `counterbore_wall` and `countersink` respectively. A hole whose diameter is larger than its face is `failed` with the catalog's code for that case.
  - `test_text_engrave_depth`: the "Deal text" faces lie 0.5 mm below Base front, measured on the exported STEP.
- [ ] **Step 3: Run** `uv run --project engine pytest engine/tests/test_mantel.py -q`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement** the six action modules. Delete the "not implemented" path.
- [ ] **Step 5: Run** `uv run --project engine pytest engine/tests -q` and `uv run --project engine ruff check engine`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add hole, extrude, fillet, chamfer, text, combine and move actions"`.

### Task 4: Steps-section parser, renderer and input validation (Worker)

**Files:**

- Create: `src/server/actions/script.ts`, `src/server/actions/validate.ts`
- Test: `src/server/actions/script.test.ts`, `src/server/actions/validate.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export type Ref =
    | { ref: "face"; of: string; name: string }
    | {
        ref: "face";
        of: string;
        normal: [number, number, number];
        near: [number, number, number];
      }
    | { ref: "edges"; of: string; between: [string, string] }
    | { ref: "edges"; of: string; around: string }
    | { ref: "datum"; name: string }
    | { ref: "part"; label: string }
    | { ref: "point"; at: [number, number, number] }
    | { fn: string }
    | { param: string };
  export type StepValue =
    | number
    | string
    | boolean
    | null
    | Ref
    | StepValue[]
    | { [k: string]: StepValue };
  export type Step = {
    action: string;
    name: string;
    inputs: Record<string, StepValue>;
    suppressed: boolean;
  };
  export function readSteps(source: string): {
    steps: Step[];
    start: number;
    end: number;
  };
  export function renderStep(step: Step): string; // one statement, 4-space indent, trailing newline
  export function writeSteps(source: string, steps: Step[]): string;
  export function validateInputs(
    action: ActionRecord,
    inputs: unknown,
  ): Record<string, StepValue>;
  ```
- Python spellings: `m.face("Base", "bottom")`, `m.face("Block", normal=(0, 0, 1), near=(12.0, 4.5, 60.0))`, `m.edges("Block", between=("top", "front"))`, `m.edges("Block", around="top")`, `m.datum("Mid plane")`, `m.part("Coin")`, `m.point(1, 2, 3)`, `mt.P("HOLE_D")`, a bare identifier for `fn`. Python tuples become JSON arrays, and dicts use string keys only. `suppressed=True` is rendered last, and only when true.
- Errors are `AppError(400, …)`. If there are no markers: `"This model has no steps section; ask the agent to adopt the standard model layout"`. For out-of-grammar content: `"Line N is not a step; ask the agent to tidy the steps section"`.

- [ ] **Step 1: Write the failing tests:**
  - `script.test.ts`:
    - `"round-trips the fixture section"`: `writeSteps(src, readSteps(src).steps) === src` for the fixture source from Task 3 (copy it as a string constant).
    - `"changes nothing outside the markers"`: after replacing the steps list, `src.slice(0, start)` and the tail after the end marker are byte-identical.
    - `"keeps tricky strings"`: a text step with `ACME × "GLOBEX" #1 \\ end` round-trips, and `#` inside the string is not a comment.
    - `"refuses misplaced markers"`: markers inside a string literal, duplicated markers, end before begin, and no markers each throw the matching message.
    - `"refuses non-step lines"`: `x = 1` or `m.hole(name="A")` (no positional name) between the markers throws `Line N is not a step`.
    - `"allows comments and blank lines"`: they are kept on rewrite when their neighbouring step is untouched. _(my call: a comment travels with the step below it.)_
  - `validate.test.ts`:
    - `"accepts the catalog examples"`: each example parses through `readSteps` and passes `validateInputs`.
    - `"rejects out-of-range numbers"`: a hole `diameter: 500` gives a message containing `diameter` and `200`.
    - `"rejects unknown keys"`: the message names the key.
    - `"checks oneOf by discriminator"`: a counterbore without `cb_depth` names `cb_depth`.
    - `"accepts param refs for numbers"`: `{param: "HOLE_D"}` where a number is expected passes.
    - `"checks ref kinds"`: a `part` ref where a face is expected is rejected.
- [ ] **Step 2: Run** `npx vitest run src/server/actions/`. Expected: FAIL.
- [ ] **Step 3: Implement** `script.ts`. Write a single-pass scanner that tracks strings (single, double and triple quotes, with escapes) and comments, so the markers are found only as whole comment lines at the same indentation inside `build()`. Then write a recursive-descent parser for `m.<ident>("<name>", key=value, …)` statements that may span lines inside brackets. In `validate.ts`, support only the schema subset the catalog uses: `type`, `properties`, `required`, `additionalProperties: false`, `enum`, `minimum`/`maximum`, `minLength`/`maxLength`, `items`, `minItems`/`maxItems`, `oneOf` with a `const` discriminator, and `x-ref: face|edges|datum|part|point|fn`. `custom` is the one exception to `additionalProperties: false`: besides `fn`, it accepts any keyword arguments whose values are `StepValue`s, rendered flat, as in `m.custom("Notch", fn=finger_notch, on=m.face(...), width=18)`. Make Task 1's catalog test fail if a schema uses any other keyword.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Parse and write the model steps section"`.

### Task 5: Step operations

**Files:**

- Create: `src/server/actions/ops.ts`
- Test: `src/server/actions/ops.test.ts`

**Interfaces:**

- Consumes: `Step`, `StepValue` from Task 4; `getAction` from Task 1.
- Produces:
  ```ts
  export type StepChange =
    | { op: "add"; step: Omit<Step, "suppressed">; after?: string } // after omitted → append
    | { op: "edit"; name: string; inputs: Record<string, StepValue> }
    | { op: "remove"; name: string }
    | { op: "move"; name: string; after: string | null } // null → first
    | { op: "suppress"; name: string; suppressed: boolean }
    | { op: "rename"; name: string; newName: string };
  export function applyStepChange(
    steps: Step[],
    change: StepChange,
    partLabels: string[],
  ): Step[];
  export function describeChange(change: StepChange): string; // activity message, e.g. `Added hole "Mount hole"`
  ```
- Names: 1–80 characters, `/^[^"\\\n]+$/`, unique across steps and the labels of existing parts, except a `body` step whose name equals the part it creates.

- [ ] **Step 1: Write the failing tests**:
  - `"adds after a named step"`.
  - `"refuses duplicate names"` → `AppError(409, 'A step or part is already named "Block"')`.
  - `"edit replaces inputs and keeps position"`.
  - `"rename rewrites later references"`: every `{of: "Mount hole"}` and `{ref: "datum", name: "Mid plane"}` in later steps follows the rename, and earlier steps are untouched.
  - `"remove leaves references for the build to block"`.
  - `"move to first"`.
  - `"unknown step"` → `AppError(404, 'No step named "X"')`.
  - `describeChange` strings for each op.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `applyStepChange`. It is a pure function and never mutates its input.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add step operations"`.

### Task 6: `actions_*` and `steps_*` tools

**Files:**

- Create: `src/server/tool-kit.ts`. Move `Tool`, `define`, `now`, `saveRevision` and `queueBuild` out of `tools.ts` unchanged and export them.
- Create: `src/server/step-tools.ts`
- Modify: `src/server/tools.ts`: import from `tool-kit.ts`; add `...stepTools` to `tools`; add the step tools to `SELF_RECORDING` and `MODEL_CHANGES`; add `summarize` cases.
- Modify: `src/server/builds.ts`: in `factsSchema`, add `steps` (array of at most 300 entries, matching Task 2's `StepLog`, `state` as an enum of the five engine states) and `incomplete` (boolean). Both are optional.
- Test: `src/server/steps.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 4 and 5; `modelAccess` and `recordEvent` as `models_set_parameter` uses them.
- Produces the following tools. Write tools take `["models.edit", "builds.run"]`, matching `models_set_parameter`.
  - `actions_list({ category?: string, query?: string })` is read-only. It returns `{ index: string, actions: {id, version, title, category, summary}[], states: StepStateRecord[] }`.
  - `actions_describe({ id: string })` is read-only and returns the full `ActionRecord`.
  - `steps_list({ modelId })` is read-only. It returns `{ revision: number, steps: Step[], health: StepLog[] | null }`, where `health` comes from the latest succeeded build of that revision.
  - `steps_add({ modelId, expectedRevision, action, name, inputs, after? })`, `steps_edit({ modelId, expectedRevision, name, inputs })`, `steps_remove({ modelId, expectedRevision, name })`, `steps_move({ modelId, expectedRevision, name, after: string | null })`, `steps_suppress({ modelId, expectedRevision, name, suppressed })` and `steps_rename({ modelId, expectedRevision, name, newName })`. Each returns `{ revision: {id, number}, job: {id, status} }`.
- Each write runs these steps in order:
  1. Read the revision `expectedRevision`.
  2. Call `readSteps`.
  3. Call `validateInputs` (add and edit).
  4. Call `applyStepChange`. The part labels come from the latest succeeded facts.
  5. Call `writeSteps`.
  6. Call `saveRevision`, then `queueBuild`.
  7. Call `recordEvent` with kind `team_edit`, payload `{ message: describeChange(...), modelId, revision, step: name }`.

  The tool descriptions name the catalog: for example, `steps_add` says "Add one modeling action as a named step. Call actions_list for the catalog and actions_describe for an action's inputs."

- [ ] **Step 1: Write the failing tests** in `steps.test.ts`. Seed a member, project and model with the fixture source at revision 1, plus a succeeded job whose facts list parts and steps, the way `sessions.test.ts` seeds builds for `models_set_parameter`.
  - `"adds a hole and queues a build"`: revision 2. Its source equals `writeSteps(fixture, [...steps, hole])`. The job is `queued`. The activity log has one `team_edit` with message `Added hole "Hole 3"`.
  - `"refuses a stale revision"` → `Model changed`.
  - `"refuses invalid inputs without saving"`: the revision count is unchanged.
  - `"refuses a free-form script"`: `examples/bridge.py` gives the no-steps-section message.
  - `"demo viewers can list but not add"`: `steps_list` and `actions_list` succeed on a demo project, and `steps_add` gives 403/404 as `models_set_parameter` does.
  - `"suppress round trip"`: the source contains `suppressed=True`. Unsuppressing removes it, and the source is byte-identical to revision 1.
  - `"facts with steps validate"`: `factsSchema.parse` accepts the Task 3 fixture's `facts.json`, copied as JSON into the test, and rejects `state: "pending"`.
- [ ] **Step 2: Run** `npx vitest run src/server/steps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Do the `tool-kit.ts` move**, then run `npm test`. Expected: the existing tests pass unchanged.
- [ ] **Step 4: Implement** `step-tools.ts` and the `builds.ts` schema change.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add action and step tools"`.

### Task 7: Always-on agent context

**Files:**

- Create: `src/server/actions/summary.ts`
- Modify: `src/server/tools.ts`. `dispatch` returns `{ value, notes, context?: string }`. For `channel === "mcp"`, it computes `context` when the input has a string `modelId` and the call succeeded. `session_start`'s result gains `actions: catalogIndex()`.
- Modify: `src/server/mcp.ts`: append `context` as a text content block after the value and before the notes.
- Test: `src/server/actions/summary.test.ts`, plus a case in `steps.test.ts`

**Interfaces:**

- Produces: `modelSummary(input: { name: string; revision: number; facts: Facts /* z.infer<typeof factsSchema> */ | null; building: boolean; steps: Step[] }): string` (pure), and `modelContext(c: Context, modelId: string): Promise<string>`, which loads the model and the latest revision and job, then calls `modelSummary`.
- Format, line by line:

  ```
  Model "<name>" r<revision>, build <ok|incomplete|failed|building|not built>.
  Steps: 1 body "Block" ok · 2 hole "Mount hole" failed face_not_found (<message ≤80 chars>) · …
  Parts: Base, Coin, Block. Planes: Mid plane. Params: BLOCK_W=80 mm, HOLE_D=5 mm.
  ```

  The step list comes from the revision source. States come from the latest build of that revision; steps not built yet show `pending`. Planes are `plane` steps. If the text would exceed 1,500 characters, drop `ok` steps from the front and replace them with `(+N earlier ok steps)`. Failed, blocked and warning steps are never dropped.

- [ ] **Step 1: Write the failing tests:**
  - `"summarises the fixture"`: exact expected text for the 7-step fixture.
  - `"marks pending steps"`.
  - `"keeps failures when truncating"`: 40 steps with long names, two of them failed. The output is ≤1,500 characters, contains both failed steps and contains `(+`.
  - `"free-form model"`: no Steps line.
  - In `steps.test.ts`, `"MCP results carry the model context"`: call `dispatch(c, "steps_list", {...}, "mcp")`. `context` starts with `Model "`. Through `"http"`, `context` is undefined.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `summary.ts`, the `dispatch` change and the `mcp.ts` change.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Give the agent a model summary with every result"`.

### Task 8: Modeling skill update

**Files:**

- Modify: `skills/modeling/SKILL.md`. Bump the builtin version in `src/server/skills.ts` from 0 to 1.
- Modify: `examples/README.md`: add a section on the standard steps layout.
- Create: `examples/deal_toy_steps.py`, a copy of the Task 3 fixture with a comment header explaining it is the reference layout.
- Test: add a case to `engine/tests/test_mantel.py`: `test_example_layout_builds` builds `examples/deal_toy_steps.py`, and every step is `ok`.

- [ ] **Step 1: Write the failing test** (the example file does not exist yet).
- [ ] **Step 2: Run** `uv run --project engine pytest engine/tests/test_mantel.py::test_example_layout_builds -q`. Expected: FAIL.
- [ ] **Step 3: Add the example and edit the skill.**
  - Insert a step after current step 5 that teaches the standard layout: `import mantel as mt`, `base()` for free Python, and `build()` with the markers.
  - Tell the agent to prefer `steps_add` with a catalog action over editing Python, and to call `actions_describe` before using an action for the first time in a session.
  - Use `custom` with `fn=` only when no action fits. If it writes the same function twice, tell the person it can be saved for reuse once saved actions ship.
  - The agent must read each tool result's model summary, and after a build, handle `failed` and `blocked` steps using the failure's `fix` text.
  - The agent must never report an `incomplete` build as a finished model.
- [ ] **Step 4: Run** the engine tests and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Teach the modeling skill the steps layout"`.

### Task 9: Read-only timeline with suppress toggle

**Files:**

- Create: `src/web/Timeline.tsx`
- Modify: `src/web/api.ts`: add `steps?: StepLog[]` and `incomplete?: boolean` to `Facts`; export `type StepLog`.
- Modify: `src/web/Workspace.tsx`: render `<Timeline>` under the viewer when `facts?.steps` exists.
- Modify: `src/web/style.css`: timeline chip styles using the existing theme tokens.
- Test: `src/web/timeline.test.ts`, a pure function test in the style of `follow.test.ts`

**Interfaces:**

- Consumes: `call("steps_suppress", …)` from `api.ts`; the catalog JSON (`stepStates` and failures) imported into the web bundle directly.
- Produces:
  ```ts
  export function timelineChips(
    steps: StepLog[],
    building: boolean,
  ): {
    name: string;
    action: string;
    state: StepLog["state"] | "pending";
    tone: "ok" | "warn" | "bad" | "muted";
    detail: string;
  }[];
  export function Timeline(props: {
    modelId: string;
    revision: number;
    steps: StepLog[];
    building: boolean;
    editable: boolean;
    onChanged: () => void;
  }): JSX.Element;
  ```
- Behaviour:
  - Tones: `ok` → ok; `warning` → warn; `failed` and `blocked` → bad; `suppressed` and `pending` → muted.
  - `detail` is the step's message, followed by the catalog failure's explanation and fix when there is a code.
  - The badge reads "Incomplete build" when `incomplete`.
  - Clicking a chip opens a popover with the action title, the state meaning, `detail`, and a suppress or unsuppress button. The button shows only when `editable`, which is computed the same way `PartPopover`'s `editable` is.
  - A `409` from the tool shows "Someone changed the model; reloading" and calls `onChanged`.
  - At phone width the chips scroll horizontally inside the strip, never the page.

- [ ] **Step 1: Write the failing test** `timeline.test.ts`: tone mapping for all six states; `detail` for `face_not_found` includes the catalog fix text; while `building` is true, steps of the current revision missing from the log show `pending`.
- [ ] **Step 2: Run** `npx vitest run src/web/timeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `timelineChips` and `Timeline`, and wire them into `Workspace.tsx`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Verify in the app.** Run `npm run dev` with a local D1 database and a local CAD container if available. Open the fixture model and confirm the chips match the build. Suppress `Mount hole 2` and confirm a new revision and rebuild, then check the chip goes muted. Check at 390 px width. If no local CAD container is available, say so in the PR and verify on the deployed preview instead. Report which one was done.
- [ ] **Step 6: Commit** `git commit -m "Show the step timeline under the viewer"`.

### Task 10: Full check and PR

- [ ] **Step 1: Run** `npm run check`. Expected: every stage passes. Fix anything red before continuing.
- [ ] **Step 2: Push** the branch and open a PR titled "Modeling actions: catalog, steps and timeline". The body covers:
  - the problem, the resulting behaviour for the agent and for the person, and the validation commands with results;
  - that saved actions and the interactive interface are the two follow-up plans;
  - the risk that build123d face signatures may need tolerance tuning on real models.

  Do not use AI attribution.

- [ ] **Step 3: Merge only after green:** `gh pr checks <N> --watch && gh pr merge <N> --squash --match-head-commit <sha>`. Then confirm `main` contains the commit and sync the local checkout.
