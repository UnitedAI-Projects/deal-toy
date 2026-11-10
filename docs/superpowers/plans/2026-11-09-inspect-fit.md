# Inspect Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A model script declares how its parts attach using build123d joints. The record lists each joint's frame and motion. In the viewer, an explode slider pulls the parts apart along their joints and back together, and the person can drag a part along its joint. Where a placement parameter drives a joint, a drag or a typed value saves one new revision, through the same edit path as adjustments A and B (adjustment C).

**Architecture:**

- **Engine.**
  - The record gains `joints`: one entry per connection between two top-level parts, read from the build's own Python objects before export.
  - A declared dimension may name a joint instead of two faces. Its value is the joint's position (mm) or angle (degrees), and `matches_param` is checked as before.
  - A new fixture, a deal-toy presentation box, has a hinged lid (revolute), a drawer (linear) and a plaque fixed to the lid (rigid).
- **Worker.** `inspect_get` returns joints; dimension checks work on joint dimensions; the agent's model summary lists placements. No new tool and no new edit path.
- **Web.**
  - A pure module, `src/web/fit.ts`, computes every part's transform from the record, the explode amount and any view-only poses.
  - The viewer moves part nodes by those transforms. Face highlights move with their parts, and picks are mapped back to the record's unmoved frame.
  - An explode slider works at every width. A "Move parts" mode on desktop drags a part along its joint. Release commits when a matching placement parameter drives the joint, and otherwise leaves a view-only pose with a Reset.

**Tech Stack:** build123d 0.13.0 and OCCT, Python 3.12, pytest; Cloudflare Workers and D1; React 19, three.js, vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-inspect-and-fit-design.md`, section "Batch 2: joints and fit", decision C, and goals 7 and 9 as they apply to fit. It builds on `2026-11-09-inspect-checks.md` (#34). The sweep check ("can this part slide into place") stays out of scope, as the spec says.

## Global Constraints

- **Explode and poses are view state.** They are never saved, and never change the record, checks or measurements. Only a commit through `models_set_parameter` changes the model.
- **Every adjustment is one `models_set_parameter` call,** through the existing range check and the `expectedRevision` conflict check. A joint drag commits only when its placement dimension has `matches_param: true` and the person can edit.
- **Every number shown comes from the record.** A moved part's values are the record's values for the unmoved part. The moved mesh is an exact rigid transform of the built mesh and is labelled "Preview" until the rebuild arrives.
- **Joint support is limited to three kinds.** Only rigid, linear and revolute joints between two top-level parts are recorded. Anything else is a warning, never a failed build.
- **Formatting:** mm with 2 decimals and degrees with 1 decimal; a drag snaps to 0.1 mm or 1°, and is clamped to the parameter's range and the joint's range.
- **Demo viewers** can explode and pose, but never commit. Moving parts by drag is desktop-only; explode works at phone width.
- **Delivery:** commit as `ichen27 <ivan27chen@gmail.com>`, with no AI attribution. The full check is `npm run check` plus the engine suite in the CAD image.

## Review Focus

1. **A part moved by two joints, or a cycle of joints:** the first connection in part order is kept and the others are dropped with a warning that names them. The transform walk always ends. Tested in Task 1.
2. **A placement dimension whose parameter does not drive the joint** (`matches_param: false`): it shows the mismatch, the typed edit refuses it, and a drag of that joint stays view-only. Tested in Tasks 2 and 5.
3. **A face picked on an exploded or posed part** gives the same face index, and so the same values, as on the collapsed model. Tested in Task 3, and checked in the app in Task 6.
4. **A revolute drag whose pointer ray runs parallel to the rotation plane, or that goes past the range:** the value holds or clamps, and is never NaN. Tested in Task 3.
5. **A rebuild that arrives while a pose is shown or a drag is in flight:** poses reset to the new record, the drag is cancelled, and one release gives exactly one revision. Tested in Task 5, and checked in the app in Task 6.

---

### Task 1: Joints in the record, placement dimensions and the presentation-box fixture

**Files:**

- Modify: `engine/lib/mantel/inspect.py`
- Create: `examples/display_box_fit.py`
- Modify: `engine/tools/gen_fixtures.py`
- Create: `engine/tests/fixtures/display_box_fit.inspect.json` and `engine/tests/fixtures/display_box_fit_posed.inspect.json`
- Test: `engine/tests/test_inspect.py`

**Interfaces:**

- Produces `record["joints"]`, a list ordered by moving part, then joint label. Each entry is `{"name": str, "kind": "rigid"|"linear"|"revolute", "part": int, "to": int, "origin": [x,y,z], "axis": [x,y,z], "range": [lo, hi|None], "value": float, "unit": "mm"|"deg"}`:
  - `part` is the index of the part that moves, and `to` the part it attaches to;
  - `name` is the joint's label on `to`;
  - `origin` and `axis` are the world frame of the joint on `to`, at build time;
  - an infinite range end is `None`, never `Infinity`, because the record must stay valid JSON;
  - `value` is `LinearJoint.position`, or `RevoluteJoint._angle` (private in build123d 0.13; a test pins it so an upgrade fails loudly);
  - a rigid joint has `range [0, 0]`, `value 0` and `unit "mm"`, and its `axis` is the joint's z direction.
- Produces dimension entries `{"name", "param", "value", "joint": int, "unit", "scale", "matches_param"}` with no `faces` or `moves`, declared in `dimensions()` as `{"name": ..., "param": ..., "joint": <the build123d joint object on the fixed part>}`.
- Face dimensions gain `"unit": "mm"`.

- [ ] **Step 1: Write the failing tests** in `test_inspect.py`:
  - `test_display_box_joints`: build `examples/display_box_fit.py`. Expect three joints:
    - the lid is revolute on the base, value 0.0 deg, range [0, 110];
    - the drawer is linear on the base, value 0.0 mm, range [0, 40];
    - the plaque is rigid on the lid.

    Each joint's `part` and `to` are the labelled parts' indices.

  - `test_placement_dimensions`: "Lid angle" (`LID_ANGLE`) and "Drawer travel" (`DRAWER_OUT`) are recorded with `joint` set, `unit` "deg" and "mm", and `matches_param` true. A copy of the module with `DRAWER_OUT` changed to 12 and the connect call left at 0 gives `matches_param` false.
  - `test_joint_value_follows_param`: with `LID_ANGLE` 60 and `DRAWER_OUT` 25 the joint values are 60 and 25. The drawer's centre of mass moves by exactly 25 along the slide axis, and the plaque's centre of mass moves with the lid.
  - `test_joint_edge_cases`, each case on small boxes:
    - a part moved by two joints keeps the first connection and warns `Part "B" is moved by two joints; only "j1" is used`;
    - a two-part cycle drops the second joint with a warning;
    - `RigidJoint.connect_to(LinearJoint)` is recorded as rigid and warns `connect from the LinearJoint on "A" to record its motion`;
    - a `BallJoint` connection is recorded as rigid with a warning;
    - an unbounded linear range serialises as `[0, null]`, and `json.dumps(record, allow_nan=False)` succeeds.
  - `test_stored_fit_fixtures_are_current`: add both new fixture records to the existing drift test.
- [ ] **Step 2: Run them.** `cd engine && .venv/bin/python -m pytest tests/test_inspect.py -k "joint or placement or display_box" -q`. Expected: FAIL, because the example and `record["joints"]` do not exist yet.
- [ ] **Step 3: Write `examples/display_box_fit.py`.** It is synthetic and labelled as not a customer design.
  - **Parts:** Base, Lid, Drawer and Plaque.
  - **PARAMS:** `LID_ANGLE` 0 (0–110, unit "deg") and `DRAWER_OUT` 0 (0–40, unit "mm").
  - **Joints:**
    - a `RevoluteJoint` on Base along the back top edge;
    - a `LinearJoint` on Base out of the front;
    - a `RigidJoint` from Lid to Plaque.
  - **Connections:** `connect_to` uses the parameter values, after every boolean, because a later boolean creates a new object without the joints.
  - **Declarations:** `dimensions()` declares the two placements.
- [ ] **Step 4: Implement `_joints(parts, record)` and the `joint` branch of `_dimensions`** in `inspect.py`. Call `_joints` in `complete()` before `_dimensions`.
  - **Collection:** walk each part's `joints`, keep those whose `connected_to.parent` is another top-level part (matched by identity), and keep the first connection per moving part.
  - **Cycles:** drop any connection that would make a cycle.
  - **Lookup:** `_dimensions` resolves `item["joint"]` to its record index by identity.
- [ ] **Step 5: Regenerate the stored records.** Add the fixture to `gen_fixtures.py`, both at defaults and with `LID_ANGLE` 60 and `DRAWER_OUT` 25 as `display_box_fit_posed`. Run it, then run `npx prettier --write engine/tests/fixtures`.
- [ ] **Step 6: Run the tests.** `cd engine && .venv/bin/python -m pytest -q`. Expected: all pass, with the image-only tests skipped as before.
- [ ] **Step 7: Commit:** "Record joints and placement dimensions; add the presentation-box fixture".

### Task 2: Shared types, `inspect_get`, dimension checks and the agent summary

**Files:**

- Modify: `src/shared/inspect-types.ts`, `src/server/inspect-tools.ts`, `src/server/checks/evaluate.ts`, `src/server/actions/summary.ts`, `src/web/adjust.ts`, `src/web/checks.ts`, `src/web/InspectPanel.tsx`, `src/web/Workspace.tsx` (type fixes only)
- Test: `src/server/inspect-tools.test.ts`, `src/server/checks/evaluate.test.ts`, `src/web/adjust.test.ts`, `src/web/checks.test.ts`

**Interfaces:**

- **Types:**
  - `JointRecord = { name; kind: "rigid"|"linear"|"revolute"; part: number; to: number; origin: Vec3; axis: Vec3; range: [number, number | null]; value: number; unit: "mm"|"deg" }`;
  - `InspectRecord.joints?: JointRecord[]`.
- **DimensionRecord:**
  - `faces` becomes optional;
  - it adds `joint?: number` and `unit?: "mm"|"deg"`, where a missing unit means mm.
- **dimensionEdit:** the signature is unchanged. Its range error uses the dimension's unit (`"Lid angle must be between 0.0 and 110.0°"`).
- **limitText:** becomes `limitText(check, unit?)`, and shows a dimension limit in degrees when the unit is "deg".

- [ ] **Step 1: Write the failing tests.**
  - `inspect_get` with `sections: ["joints"]` on the display box returns three joints. `parts: ["Plaque"]` returns only the joint that moves or holds the Plaque.
  - A dimension check on "Lid angle" with nominal 0 ± 1 passes with `unit: "deg"` and `parts: [lid index]`, and has no `faces`.
  - The `dimensionEdit` range error for "Lid angle" reads in degrees.
  - `checkFromSelection` on the picked Drawer part offers "Drawer travel".
  - `limitText` for a deg dimension reads `0.0 ± 1.0°`.
  - The model summary from `modelContext` contains `Placements: Lid angle 0.0° (LID_ANGLE), Drawer travel 0.00 mm (DRAWER_OUT)`.
- [ ] **Step 2: Run them.** `npx vitest run src/server/inspect-tools.test.ts src/server/checks src/web/adjust.test.ts src/web/checks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the types; then `npx tsc --noEmit` lists every use of `dim.faces`, and each one gets a guard.
  - **Evaluator:** sets `unit` from the dimension, and `parts` from the joint when there is one.
  - **inspect_get:** adds a `joints` section and filters joints by `part` or `to`.
  - **Agent text:** the tool descriptions and the summary line mention joints.
- [ ] **Step 4: Run `npm run check`.** Expected: all pass.
- [ ] **Step 5: Commit:** "Read joints and placement dimensions in the Worker and checks".

### Task 3: Fit math (`src/web/fit.ts`)

**Files:**

- Create: `src/web/fit.ts`
- Test: `src/web/fit.test.ts`

**Interfaces:**

- **Types:** `type Mat4 = number[]` is a 4×4 matrix in column-major order, like three.js, in the model frame (mm).
- **`jointMotion(joint: JointRecord, value: number): Mat4`:** moves the part from `joint.value` to `value`.
  - A linear joint translates by `(value − joint.value) · axis`.
  - A revolute joint rotates about the line `origin + t·axis`, by the right-hand angle `(value − joint.value)°`.
  - A rigid joint gives the identity.
- **`partTransforms(record, explode: number, poses: Record<number, number>): Mat4[]`:** one matrix per part, indexed like `record.parts`. Each moving part's matrix is its parent's matrix, times its explode offset, times its joint's motion to `poses[jointIndex]` (or no motion when the joint is not posed).
- **`explodeOffsets(record, amount: number): Vec3[]`:** `amount` runs from 0 to 1, and the distance per joint level is `amount × 0.5 ×` the assembly's bounding-box diagonal.
  - A linear joint's part moves along `+axis`.
  - A revolute or rigid joint's part moves along the unit vector from the `to` part's centre of mass to its own. When the two centres coincide, it moves along the joint's axis.
  - Root parts stay still. When the record has no joints, every part moves radially from the assembly's centre of mass, and a part at the centre moves along +Z.
- **`applyPoint(m: Mat4, p: Vec3): Vec3` and `invertRigid(m: Mat4): Mat4`:** a pick on a moved part maps back to the record's frame through `applyPoint(invertRigid(m), hit)`.
- **`angleAround(rayOrigin, rayDir, axisOrigin, axisDir, ref: Vec3): number | null`:** the signed angle in degrees, right-hand about the axis, of where the ray meets the plane through `axisOrigin` normal to the axis. It returns `null` when `|rayDir·axis| < 1e-6` or the hit is on the axis.
- **`jointDragValue(joint, spec?: ParamRange & {scale?}, start: number, delta: number): number`:** snaps to 0.1 mm or 1°, then clamps to the joint's range and the parameter's range, where the parameter's range is multiplied by its scale.

- [ ] **Step 1: Write the failing tests.**
  - **Cross-check with build123d:** apply `partTransforms(defaults, 0, {lid: 60, drawer: 25})` to each part's `center_of_mass` in `display_box_fit.inspect.json`. Each must equal that part's `center_of_mass` in `display_box_fit_posed.inspect.json` within 1e-4 mm. This includes the Plaque, which moves only because it rides on the lid.
  - **Collapse:** `explode` 0 with no poses gives identities.
  - **Explode directions:** on the enclosure record, which has no joints, the parts move apart radially. On the display box, the drawer moves along the slide axis, and the plaque moves at least as far as the lid.
  - **Unmoving a pick:** `applyPoint(invertRigid(m), applyPoint(m, p))` returns `p`. A face picked from a hit point mapped this way gives the same `pickFace` index as on the collapsed model.
  - **`angleAround`:** returns 90 for a quarter turn, −90 the other way, and `null` for a ray in the rotation plane.
  - **`jointDragValue`:** clamps 130° to 110 and 41 mm to 40, snaps 12.34 mm to 12.3, and never returns NaN when `delta` is NaN; it returns `start` instead.
- [ ] **Step 2: Run them.** `npx vitest run src/web/fit.test.ts`. Expected: FAIL, because the module does not exist.
- [ ] **Step 3: Implement `fit.ts`.** It uses plain arrays, with no three.js import, so the Worker never pulls three.
- [ ] **Step 4: Run `npx vitest run src/web/fit.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit:** "Compute explode and joint poses from the record".

### Task 4: Viewer: moved parts, overlays that follow them, picks and the joint drag gesture

**Files:**

- Modify: `src/web/Viewer.tsx`
- Modify: `src/web/overlays.ts` (`overlayGroup` gains an optional per-part split)
- Test: `src/web/overlays.test.ts`

**Interfaces:**

- **New prop `pose?: { key: string; matrices: Mat4[] } | null`** (the existing `parts` prop keeps the labels): matrices are in the model frame. The viewer converts each one to scene space as `S · M · S⁻¹`, where `S` is the `toScene` mapping and the scale. It sets each labelled part node's local matrix from its original local matrix, so a later null restores the build's pose exactly.
- **Face overlays and caps:**
  - face overlays are built per part, and each part's group takes that part's scene matrix;
  - the B handle and ghost previews are hidden while any matrix is not the identity;
  - section caps keep working, with the plane fixed in the world.
- **Picks:** the clicked point is mapped through `invertRigid` of the hit part's matrix before `onSelect`, so `pickFace` sees the record's frame.
- **New prop `move?: { joints: number[]; onStart(joint: number): void; onMove(delta: number): void; onRelease(): void; onCancel(): void } | null`:**
  - pointerdown on a part whose joint is listed takes the gesture, as the B handle does (capture phase, controls off);
  - `delta` is mm along the joint axis (`alongAxis`) for a linear joint, or the unwrapped degrees from `angleAround` for a revolute joint, both measured on the axis as moved by the parent's matrix;
  - Escape cancels.

- [ ] **Step 1: Write the failing test.** `overlayGroup(record, faces, scale, color, { byPart: true })` returns one child group per part with faces, named `part-<index>`.
- [ ] **Step 2: Run `npx vitest run src/web/overlays.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement the split, then the viewer props.** The viewer has no unit tests; it is checked in the app in Task 6.
- [ ] **Step 4: Run `npm run check`.** Expected: all pass.
- [ ] **Step 5: Commit:** "Move parts in the viewer and drag them along their joints".

### Task 5: Workspace and Inspect panel: explode, move parts, and placement edits

**Files:**

- Modify: `src/web/Workspace.tsx`, `src/web/InspectPanel.tsx`, `src/web/style.css`
- Create: `src/web/fit-state.ts` (a pure reducer for explode, poses and the drag)
- Test: `src/web/fit-state.test.ts`

**Interfaces:**

- **`fitReducer(state, action)`:**
  - **State:** `{ buildId, explode: number, poses: Record<number, number>, drag: { joint, start, value } | null, viewOnly: boolean }`.
  - **Actions:**
    - `explode(amount)` and `collapse`;
    - `start(joint, value)`, `move(value)` and `cancel`;
    - `release → { state, commit?: { joint, value } }`;
    - `reset`;
    - `record(buildId)`, which clears poses and any drag when the build changes.
- **Release:** commits only when a placement dimension names the joint, has `matches_param` set, and the person can edit. Otherwise the pose stays, with `viewOnly: true`.
- **Toolbar:**
  - an "Explode" chip opens a slider (0–100 %) and a "Collapse" button, at every width;
  - a "Move parts" chip appears on wide screens only, when the record has a linear or revolute joint.
- **Live label:** while dragging, a label shows `Lid angle 42.0° · Preview`, or `View only: not saved` with a Reset button after a release that did not commit.
- **Inspect panel, for a picked part:**
  - shows `Attached to Base by "hinge" (revolute) · 0.0° (0.0–110.0°)`, or `Not attached by a joint`;
  - shows its placement dimension with the same inline edit as other declared dimensions (`onAdjust`).

- [ ] **Step 1: Write the failing tests** in `fit-state.test.ts`:
  - a release with a matching placement returns exactly one `commit`, and a second release returns none;
  - a release with `matches_param` false, or without edit rights, returns no commit and sets `viewOnly`;
  - `cancel` restores the pose from before the drag;
  - `record` with a new build id clears poses and an in-flight drag;
  - explode values are clamped to the range 0–1.
- [ ] **Step 2: Run `npx vitest run src/web/fit-state.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement the reducer, then wire the Workspace.** A commit calls the existing `adjust(dim, value)`. The B face handle and the ghost previews are hidden while exploded or posed.
- [ ] **Step 4: Run `npm run check`.** Expected: all pass.
- [ ] **Step 5: Commit:** "Explode, collapse and move parts in the workspace".

### Task 6: Skills, in-app check, docs and PR

**Files:**

- Modify: `skills/modeling/SKILL.md`, `skills/inspecting/SKILL.md`, `src/server/skills.ts` (modeling v5, inspecting v2), `README.md`, `examples/README.md`, `docs/validation.md`
- Create: `docs/images/workspace-explode.png`, `docs/images/workspace-move.png`, `docs/images/workspace-explode-mobile.png`

- [ ] **Step 1: Update the skills.**
  - **Modeling:**
    - build each part completely before declaring its joints;
    - connect from the fixed part's linear or revolute joint to the moving part's rigid joint, with the position or angle taken from a `PARAMS` entry;
    - declare `{"name", "param", "joint"}` in `dimensions()`.
  - **Inspecting:** read `joints` with `inspect_get`, and set placements with `models_set_parameter`.
- [ ] **Step 2: Check in the app** on local `wrangler dev`, with a member and the demo viewer, at desktop and 390 px, in both themes. Expected:
  - explode and collapse work on the display box and on the enclosure, whose parts move radially;
  - a picked face on an exploded part shows the same values as when collapsed;
  - dragging the lid to 60° and releasing gives one revision, and the rebuilt lid lands where the preview was;
  - a drawer drag by the demo viewer stays view-only and Reset restores it;
  - Escape cancels;
  - a section works while exploded;
  - the agent's MCP summary lists the placements.

  Take the three screenshots.

- [ ] **Step 3: Run the full checks.** `npm run check` and the engine suite in the CAD image (`ci/engine-tests-in-image.sh`). Expected: all pass. Record the build-time cost of the joints step in `docs/validation.md`.
- [ ] **Step 4: Commit, push `feat/inspect-fit` and open a PR.** The PR covers the problem, the behaviour, the validation and the risks. The main risk is `RevoluteJoint._angle`, which is private in build123d 0.13 and pinned by a test.
