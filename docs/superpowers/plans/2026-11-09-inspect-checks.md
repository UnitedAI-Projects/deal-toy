# Inspect Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each model has a saved check list that the person and the agent edit together. Every build shows each check as pass, fail or unknown, and colours failures on the model. A declared dimension can be changed by typing a value or by dragging its face. Measurements the record cannot answer, such as the distance between two curved faces, are computed by a measure job on the build's STEP. Parts with a pull direction report draft.

**Architecture:**

- **Engine.**
  - The record gains `draft` for parts named in a top-level `PULL`.
  - A new measure mode loads a build's persisted STEP, without running the model's Python, and returns exact face-to-face or part-to-part distances, addressed by record index.
  - Tests pin that STEP reload keeps the build's face indices.
- **Worker.**
  - Check lists live in D1 as one versioned document per model.
  - A single pure evaluator, `evaluateChecks(record, facts, checks, measurements)`, produces every result. It is never run in the browser.
  - Measure jobs are a fourth job `purpose`, queued like builds. Their results are stored per build.
- **Web.**
  - A Checks panel lists results, edits limits and enabled state, adds checks from the selection or a preset, and compares each check with the previous revision.
  - Failures are coloured on the model.
  - Declared dimensions are edited inline (A) or by dragging a handle (B). Both go through `models_set_parameter`.

**Tech Stack:** build123d 0.13.0 and OCCT, Python 3.12, pytest; Cloudflare Workers, D1, R2, Queues and the live relay; React 19, three.js, vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-inspect-and-fit-design.md` (#28). This plan completes batch 1:

- goals 4, 5, 6 and 8;
- goal 7 for checks, measure and adjust;
- goal 9 for checks and adjust;
- the draft and pull-direction section;
- the enclosure fixture.

It builds on `2026-11-06-inspect-core.md` (#32) and `2026-11-06-actions-interface.md` (#33). Batch 2 (joints, explode and collapse, adjustment C) gets its own plan after this one.

## Global Constraints

- **Unknown is never pass.** A check whose target cannot be resolved, whose limit is unset, or whose measurement is missing shows `unknown`, with a reason a person can act on.
- **Evaluation happens only in the Worker.** It is a pure function of the record, the facts, the list and the stored measurements. Changing a limit or the enabled state re-evaluates without a rebuild.
- **Every adjustment is one `models_set_parameter` call.** It goes through the existing range check and the `expectedRevision` conflict check, and nothing else is written.
- **Every check records who made each change.** It stores `created_by` and `edited_by` as `{ email, agent: boolean }`, where `agent` is true when the change came through MCP. The server stamps these; the client cannot set them.
- **Demo viewers have read access only.** They can list checks and read results. They cannot save checks, queue measure jobs, adjust or highlight.
- **Measure jobs:**
  - they count toward the daily build limit and need the `builds.run` permission plus write access;
  - they never run model Python and write no revision;
  - each requested measurement is queued at most once per build.
- **No invented supplier limits.** Preset limits are `null` and display as "TBD: confirm with your maker".
- **Formatting and approval:**
  - lengths display in mm with 2 decimals and angles in degrees with 1 decimal;
  - `manufacturing_approval` stays `"not_reviewed"`;
  - a passing list never says "approved".
- **Delivery:** commit as `ichen27 <ivan27chen@gmail.com>`, with no AI attribution. The full check is `npm run check` plus the engine suite in the CAD image.

## Review Focus

1. **A check on a picked face after a parameter change that moves the face:** it still resolves to the moved face. After a change that deletes the face, it becomes `unknown: re-pick needed`. It never jumps to another face. Tested in Task 3.
2. **The person and the agent edit the list at the same time:** the second save, sent with a stale `expectedVersion`, gets 409, and neither overwrites the other. Tested in Task 3.
3. **A declared dimension with `matches_param: false`:**
   - it is shown with its mismatch, but has no edit field and no drag handle;
   - `dimensionEdit` refuses it.

   Tested in Task 6.

4. **A measure request on a build without `model.step` or `inspect.json`** (an old build or a preview): the check reports `unknown`, giving the reason, and no job is queued. A measure job whose STEP has disappeared fails with a clear error. Tested in Task 4.
5. **A demo viewer:**
   - `checks_save` and the queueing paths of `inspect_measure` give 403, and nothing is written or queued;
   - `checks_list` and `checks_results` still work.

   Tested in Tasks 3 and 4.

---

### Task 1: Draft, the enclosure fixture, and STEP index agreement

**Files:**

- Modify: `engine/lib/mantel/inspect.py`, which adds `_draft(parts, module, record)` and calls it from `complete()`.
- Create: `examples/enclosure_inspect.py`, the spec's second fixture:
  - a housing whose ribs run into the screw bosses by a known volume;
  - vertical walls (0° draft) with `PULL = {"Housing": (0, 0, 1)}`;
  - a cover whose lip sits 0.30 mm from the housing wall;
  - `dimensions()` declaring the wall thickness and lip clearance.
- Test: `engine/tests/test_inspect.py`

**Interfaces (record additions):**

- **`draft`:** `[{"part": int, "pull": [x, y, z], "faces": [{"index": int, "angle_deg": float, "sampled": bool}]}]`, for each label in a top-level `PULL = {label: (x, y, z)}`.
  - **Planes:** the angle is `degrees(asin(|n·d|))`, with `d` the normalised pull. Faces with `|n·d| > cos(0.5°)`, the faces square to the pull, are left out.
  - **Cylinders:** an axis parallel to `d` gives 0. Any other axis is sampled.
  - **Cones:** an axis parallel to `d` gives the half-angle.
  - **Any other face:** the minimum over a 5×5 UV grid of OCCT normals, with `"sampled": true`.
  - **Unknown labels:** a label that is not a part, or a zero vector, adds a warning.
- **Face order after STEP reload:** the face order of `bd.import_step(model.step)` must match the build's record index for index, comparing type, area to 1e-6 and centre to 1e-6. The labels of the reloaded children must also match.

- [ ] **Step 1: Write the failing tests:**
  - `test_draft_of_box_walls_is_zero`: a box with pull +Z gives 4 side faces at 0.0°, and leaves out its top and bottom.
  - `test_draft_of_tapered_wall`: a 2° taper gives 2.0° to within 1e-6.
  - `test_draft_on_cone`: a cone with a 3° half-angle on the pull axis gives 3.0°.
  - `test_draft_unknown_part_warns`.
  - `test_enclosure_fixture`:
    - the rib–boss overlap volume equals the analytic value to 1e-6;
    - the lip dimension is 0.30;
    - every housing side wall has 0.0° draft.
  - `test_step_reload_keeps_face_indices`: this runs for `bridge.py`, `deal_toy_inspect.py`, `deal_toy_steps.py` and `enclosure_inspect.py`.
- [ ] **Step 2: Run** `uv run --project engine pytest engine/tests/test_inspect.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** draft and the fixture. If the reload test fails for a fixture, measure jobs cannot address faces by build index. Then the ruling is to compute the build's record on the STEP-reloaded shape, mapping `dimensions()` faces across by signature, and ledger it.
- [ ] **Step 4: Run** the engine suite and ruff, locally and in the CAD image. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Measure draft along a declared pull direction and add the enclosure fixture"`.

### Task 2: Measure mode in the engine

**Files:**

- Create: `engine/measure.py`. It reads `model.step` and `requests.json` and writes `measure.json`. It imports no user code, and runs under the same `limits()` as `runner.py`.
- Modify: `engine/service.py`, adding `POST /measure` with the body `{ step: base64, requests: [...] }`. It runs `measure.py` in a subprocess with the build timeout, and replies `{ results: [...] }`.
- Test: `engine/tests/test_measure.py`

**Interfaces:**

- A request is `{ "key": str, "a": Target, "b": Target }`, with a `Target` of `{"face": int}` or `{"part": int}`. Indices use the record's order, and there are at most 50 requests.
- A result is `{ "key": str, "distance": float, "points": [[x,y,z], [x,y,z]] }`, or `{ "key": str, "error": str }` for an index out of range. Distances come from `BRepExtrema_DistShapeShape`.
- The STEP is at most 15 MiB. A larger or unreadable STEP, or a malformed request, gives a 400 reply with `{ error }`.

- [ ] **Step 1: Write the failing tests:**
  - `test_measure_cylinder_to_plane`: a pin of diameter 4 whose axis is 10 mm from a wall measures 8.0.
  - `test_measure_matches_record_indices`: on the enclosure fixture, measure the lip faces named by the record's `dimensions` entry, and get 0.30.
  - `test_measure_rejects_bad_index`.
  - `test_measure_runs_no_model_code`: a STEP plus a request runs with no `source` present.
  - `test_service_measure_endpoint`: this test uses the in-process handler, as the existing service tests do.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the engine suite in the CAD image, and update `ci/container-smoke.py` to call `/measure` once on the smoke build's STEP. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Measure exact distances on a build's STEP without running its script"`.

### Task 3: Check lists and the evaluator

**Files:**

- Create: `migrations/0008_checks.sql`, with the tables:
  - `check_lists(model_id TEXT PRIMARY KEY REFERENCES models(id), version INTEGER NOT NULL, checks TEXT NOT NULL, updated_at TEXT NOT NULL)`
  - `measurements(build_id TEXT NOT NULL REFERENCES jobs(id), key TEXT NOT NULL, value TEXT, job_id TEXT, status TEXT NOT NULL, PRIMARY KEY(build_id, key))`
- Create: `src/server/checks/types.ts`, `src/server/checks/evaluate.ts`, `src/server/checks/resolve.ts`, `src/server/checks/presets.ts`, `src/server/check-tools.ts`. Register them in `src/server/tools.ts`.
- Modify: `src/server/core.ts`, giving `Context` an optional `channel?: Channel`, set in `dispatch`.
- Modify: `src/server/actions/summary.ts`, so `modelContext` appends `Checks: 4 pass · 1 fail (Embed wall "Coin" 1.50 mm < 2.00 mm) · 1 unknown`.
- Test: `src/server/checks/evaluate.test.ts`, `src/server/checks/resolve.test.ts`, `src/server/checks.test.ts`

**Interfaces:**

```ts
type Target = { face: number } | { part: number }; // record indices, as in Task 2
type FaceTarget = {
  ref?: Ref;
  signature: {
    part: string;
    type: string;
    direction: Vec3;
    center: Vec3;
    area: number;
  };
};
type Check = {
  id: string;
  name: string;
  enabled: boolean;
  kind:
    | "stability"
    | "embed_wall"
    | "dimension"
    | "clearance"
    | "no_overlap"
    | "envelope"
    | "hole"
    | "draft";
  target:
    | {}
    | { part: string }
    | { dimension: string }
    | { parts: [string, string] }
    | { faces: [FaceTarget, FaceTarget] }
    | { all: true }
    | { face: FaceTarget };
  limit: {
    min?: number | null;
    max?: number | null;
    nominal?: number;
    tolerance?: number;
    size?: Vec3;
  };
  exceptions?: FaceTarget[];
  created_by: By;
  created_at: string;
  edited_by: By;
  edited_at: string;
};
type By = { email: string; agent: boolean };
type CheckResult = {
  id: string;
  status: "pass" | "fail" | "unknown";
  value?: number;
  unit?: "mm" | "mm³" | "deg";
  reason?: string;
  near?: boolean;
  faces?: number[];
  parts?: number[];
  measure?: { key: string; a: Target; b: Target };
};
export function evaluateChecks(
  record: InspectRecord,
  facts: Facts,
  checks: Check[],
  measurements: Record<string, number>,
): CheckResult[];
export function resolveFace(
  record: InspectRecord,
  target: FaceTarget,
): { index: number } | { unknown: string };
```

- **Pass rules.** These are the spec's table, plus:
  - `no_overlap` passes at ≤ 0.001 mm³. `{all: true}` skips declared embed pairs and every pair with a duplicate label.
  - `near` is true on a pass within 10% of the limit.
  - A disabled check is returned with `status: "unknown"` and the reason `"Turned off"`, and is not counted in the summary.
- **Unknown reasons, in plain text:**
  - "Limit not set (TBD: confirm with your maker)"
  - "Re-pick needed: the face is gone"
  - "Two parts are labelled X"
  - "Assumes uniform density: declare every part's density"
  - "Not measured: the model has over 20,000 faces"
  - "Not measured: only the first 30 parts are paired"
  - "Needs an exact measure" (with `measure` set)
  - "Measuring…"
  - "No pull direction for X"
  - "This build has no inspection record"
- **`resolveFace`:**
  1. Use `ref` first, through the record's face `names` and `sides`.
  2. Otherwise, take the faces on the signature's part with the same type and a direction within 1° (axis or normal).
  3. Pick the nearest centre. Accept it only if there is one candidate, or if the next-nearest is more than twice as far away plus 0.5 mm.
  4. Otherwise return unknown: "Re-pick needed: more than one face matches".
- **Tools:**
  - **`checks_list({ modelId })`** (read access) returns `{ version, checks, presets }`. Presets come from `presets.ts`. "Acrylic embedment" holds Stability, an Embed wall per declared embed, and No overlap for all parts; "Plaque" holds an engraving Dimension and an Envelope. Every preset limit is `null`.
  - **`checks_save({ modelId, checks, expectedVersion })`** (write access) replaces the list. It allows at most 100 checks and unique ids. It stamps `created_*` for new ids and `edited_*` for changed ones from `c.identity` and `c.channel === "mcp"`, ignoring any client-sent stamps. A stale version gives 409.
  - **`checks_results({ modelId, revision? })`** (read access) evaluates the revision's newest successful build, by default the latest revision. It returns `{ revision, buildId, results, previous? }`. For each check, `previous` holds `{ revision, status, value }` from the newest earlier revision that has a successful build.
- **The summary line** is computed from `checks_results` for the latest revision, failures first, and is at most 300 characters.

- [ ] **Step 1: Write the failing tests:**
  - **`evaluate.test.ts`**, on recorded inspect fixtures saved from the engine as JSON under `src/server/checks/fixtures/` (deal toy and enclosure):
    - one pass and one fail per kind;
    - each unknown reason above;
    - `near`;
    - a disabled check;
    - `no_overlap` all skips the embed.
  - **`resolve.test.ts`:**
    - a ref by name, and a ref by side;
    - a signature after the face moved 3 mm resolves;
    - two equal candidates give unknown;
    - a deleted face gives unknown (Review Focus 1).
  - **`checks.test.ts`:**
    - save then list;
    - a stale version gives 409 (Review Focus 2);
    - an MCP save sets `agent: true`, and an HTTP save sets `agent: false`;
    - client-sent `created_by` is ignored;
    - `checks_results` with `previous`;
    - a demo viewer can list and read results, but `checks_save` gives 403 (Review Focus 5);
    - another member's private model gives 404;
    - the `modelContext` line appears.
- [ ] **Step 2: Run** `npx vitest run src/server/checks src/server/checks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Save check lists and evaluate them against every build"`.

### Task 4: Measure jobs

**Files:**

- Modify: `src/server/tool-kit.ts`. `JobPurpose` gains `"measure"`.
- Modify: `src/server/builds.ts`. `consume` gains a measure branch. It loads `builds/<build>/model.step` from R2, calls `http://cad/measure`, and writes each result into `measurements`. The job is marked succeeded, with facts `{"measured": n}`, and the branch notifies `workspace`. A missing STEP fails the job with "The build's STEP is gone" and marks its `measurements` rows `failed`.
- Modify: `src/server/check-tools.ts`, adding `inspect_measure({ buildId, a: Target, b: Target })`.
  1. It answers immediately from the record when it can: part pairs, parallel planes, coaxial cylinders, or a stored measurement.
  2. Otherwise, with write access and `builds.run`, it inserts a `queued` measurement row (`INSERT OR IGNORE`, so one per key) and queues one measure job.
  3. It returns `{ status: "queued", jobId }`. Polling uses `builds_get`.
- After a build succeeds, `consume` queues one measure job for the requests named by that build's unknown "Needs an exact measure" results, attributed to the build's `created_by`. A failure to queue becomes a warning, not a failed build.
- Modify: `src/server/index.ts` and the workspace queries. Any listing that shows builds must keep `purpose='build'`. Verify with grep, and test the one that matters.
- Test: `src/server/measure.test.ts`, using the mock container with a `/measure` reply.

- [ ] **Step 1: Write the failing tests:**
  - **Answered from the record:** a parallel-plane request returns immediately.
  - **Queueing:** a curved pair queues exactly one job; a second call reuses it.
  - **Results and checks:** the consumer writes the result, after which `checks_results` gives pass or fail with the value.
  - **After a build:** the post-build auto-queue creates one measure job for a clearance check between curved faces.
  - **Refusals and failures:**
    - a preview build, or a build without inspect.json, gives unknown, with no job (Review Focus 4);
    - a missing STEP fails the job clearly;
    - a demo viewer gets 403, with no row and no job (Review Focus 5).
  - **Limits and listings:**
    - a measure job counts toward `DAILY_BUILD_LIMIT`;
    - a measure job does not appear as the revision's build in `projects_get`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Queue exact measure jobs for checks the record cannot answer"`.

### Task 5: Checks panel, colours, and "Ask the agent"

**Files:**

- Create: `src/web/ChecksPanel.tsx` and `src/web/checks.ts`. `checks.ts` holds the pure helpers: `checkFromSelection`, `overlayTones` and `resultText`.
- Modify: `src/web/Workspace.tsx`, which adds a "Checks" toolbar button. The panel refetches `checks_results` on `workspace` live messages and after saves. Modify `src/web/overlays.ts`, `src/web/Viewer.tsx` (failure tones) and `src/web/style.css`.
- Modify: `src/web/InspectPanel.tsx`, adding "Add check" and "Ask the agent…" for the current selection.
- Test: `src/web/checks.test.ts`

**Interfaces:**

- `checkFromSelection(record, picks): { kind: Check["kind"]; name: string; target; limit }[]` gives the checks that make sense for the selection:
  - two parts → clearance, no overlap;
  - two faces → clearance;
  - a hole face → hole;
  - a face in a declared dimension → dimension;
  - an embed part → embed wall;
  - a part named in `PULL` → draft;
  - nothing picked → stability, envelope.

  Face targets carry `refFromPick` and the face signature.

- `overlayTones(record, results, toggles): { faces: Map<number, "fail" | "warn">; parts: Map<string, "fail" | "warn"> }`:
  - overlap fails are red;
  - clearance and draft fails are amber;
  - the three toggles are overlap, clearance and draft.
- **The panel:**
  - Rows read name, status chip, value against the limit, and the previous-revision comparison ("0.30 mm in rev 6 → 0.10 mm in rev 7").
  - Unknown rows show their reason, with "Measure" when `measure` is set and the member can build. A preset row with a `null` limit shows "TBD: confirm with your maker".
  - Each row offers an inline limit edit and an enable toggle, and shows who last edited it, with "agent" marked.
  - Presets are offered from `checks_list`.
  - Saves go through `checks_save` with the list version; a 409 reloads with a message.
- **"Ask the agent…"** calls `notes_add` with the typed request, followed by the selection's references in script form (`refText`).
- **Demo viewers** see the panel read-only, with no Add, edit, toggle or Measure.

- [ ] **Step 1: Write the failing tests:**
  - `checkFromSelection` for each selection case above;
  - `overlayTones` colours overlap red and clearance amber, and a toggle off removes that tone;
  - `resultText` formats mm and deg values, and the previous-revision text.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run typecheck` and `npm run build`.
- [ ] **Step 4: Run** `npx vitest run src/web`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Show, edit and colour checks in the workspace"`.

### Task 6: Adjust declared dimensions by typing (A) and dragging (B)

**Files:**

- Create: `src/web/adjust.ts`. Modify `src/web/InspectPanel.tsx` (inline edit), `src/web/Viewer.tsx` (handle, drag and ghost) and `src/web/Workspace.tsx`, which commits through `models_set_parameter` with `expectedRevision`.
- Test: `src/web/adjust.test.ts`

**Interfaces:**

```ts
export function dimensionEdit(
  dim: DimensionRecord,
  params: Record<string, ParamSpec>,
  value: number,
): { name: string; value: number } | { error: string };
export function dragAxis(
  record: InspectRecord,
  dim: DimensionRecord,
): { origin: Vec3; direction: Vec3; sign: 1 | -1 } | null;
export function dragValue(
  dim: DimensionRecord,
  spec: ParamSpec,
  along: number,
  sign: 1 | -1,
): number;
export function alongAxis(
  rayOrigin: Vec3,
  rayDir: Vec3,
  axisOrigin: Vec3,
  axisDir: Vec3,
): number;
```

- **`dimensionEdit`** returns `{ name: dim.param, value: value / dim.scale }`. It refuses when there is no param, when `matches_param` is false ("The declaration doesn't match WALL_T; ask the agent to fix it"), or when the value is out of the parameter's range, with the range in the message.
- **`dragAxis`** uses the `moves` face's centre and normal. `sign` is +1 when moving along the normal moves the face away from the other face of the dimension. It returns null without `moves`, for a non-plane face, or when `matches_param` is false.
- **`dragValue`** returns `dim.value + sign·along`, snapped to 0.1 mm and clamped to the parameter range times scale.
- **`alongAxis`** is the closest-approach parameter between the pointer ray and the axis line, in model mm.
- **Viewer behaviour while dragging:**
  - the handle shows only on desktop, for members who can edit, when the face's part is shown;
  - dragging disables orbit, draws a dashed outline of the `moves` face at its new offset, and shows the live value in a label marked "preview";
  - release commits once, and Escape cancels;
  - on 409, the edit is refused with "Model changed. Reload before saving.", and the ghost is removed.

- [ ] **Step 1: Write the failing tests:**
  - `dimensionEdit` with scale 2 halves the value;
  - out of range gives an error naming the range;
  - `matches_param` false is refused (Review Focus 3);
  - `dragAxis` gives the right sign for the outer wall and for an inner face, and null when `matches_param` is false;
  - `dragValue` snaps and clamps;
  - `alongAxis` handles a perpendicular ray, an oblique ray, and a parallel ray (which gives 0).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run typecheck` and `npm run build`.
- [ ] **Step 4: Run** `npx vitest run src/web`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Change declared dimensions by typing or dragging their face"`.

### Task 7: Skills, in-app check, docs and PR

**Files:**

- Modify: `skills/inspecting/SKILL.md` (version 2). It covers:
  - setting up checks from a brief with `checks_list` presets and `checks_save`;
  - reading `checks_results` after every build and reporting failures and unknowns with their reasons;
  - using `inspect_measure` for curved pairs;
  - never filling a preset limit the brief does not state.
- Modify: `skills/modeling/SKILL.md` (version 4): declare `PULL` for moulded parts.
- Modify: `README.md`, `docs/validation.md` and `examples/README.md`.
- Record the record size and build-time overhead for both fixtures and the demo models in `docs/validation.md`.

- [ ] **Step 1: Check in the app** with local `wrangler dev` and the CAD container. Check light, dark and 390 px, and save `docs/images/workspace-checks.png` and `docs/images/workspace-drag.png`.
  1. On `deal_toy_inspect.py`:
     1. Apply "Acrylic embedment". Its rows show TBD.
     2. Set the embed wall limit to 2.00. It fails, at 1.50 mm, and the coin is coloured.
     3. Type 2.5 on the coin offset dimension. A new revision builds, and the row shows the previous-revision comparison.
     4. Drag the block's front face. The preview number snaps, and release saves one revision.
  2. On `enclosure_inspect.py`:
     1. The no-overlap check fails red on the ribs, and the draft check fails amber.
     2. A clearance check between the boss and pin cylinders queues a measure job and settles.
  3. Through MCP, `checks_results` and the summary line show the same results.
- [ ] **Step 2: Run** `npm run check` and the engine tests in the CAD image. Expected: PASS.
- [ ] **Step 3: Review the branch**, then push and open the PR "Inspect checks: saved checks, measure jobs, draft and dimension edits". Merge only after green with `--match-head-commit`. Watch the deploy, including migration 0008, then check `/health` for the merge release.
