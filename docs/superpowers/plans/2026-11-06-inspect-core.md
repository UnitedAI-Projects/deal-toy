# Inspect Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every build records exact measurements of its parts and faces. The person clicks faces and parts to read them, measures between two selections, and cuts a section through the model. The agent reads the same record and can highlight faces or parts in a watching viewer.

**Architecture:**

- **Inspection record.** The engine writes `inspect.json` beside `facts.json`, with per-part data, per-face data, grouped holes, thickness, part pairs, declared dimensions, materials, embeds and stability.
- **Storage and serving.** The Worker stores it as a fifth allowlisted artifact and serves it with read access.
- **Picking.** The browser maps a click to a face using the hit point and the record's exact surface data (plane, cylinder axis and radius, bounding boxes), not mesh triangles. No GLB change is needed, and every number shown comes from OCCT.
- **Overlays.** Highlights and section caps are drawn as overlays in the viewer.

**Tech Stack:** build123d 0.13.0 and OCCT, Python 3.12, pytest; Cloudflare Workers, D1, R2 and the Durable Object live relay; React 19 and three.js 0.186; vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-inspect-and-fit-design.md` (#28). This plan covers goals 1, 2, 3, 7 (inspect and highlight), 9 (read-only demo), 10 (stability and embeds, measured) and 11. Checks, adjustments A, B and D, measure jobs and draft follow in `2026-11-06-inspect-checks.md`.

## Global Constraints

- Values on screen come from the record, never from the mesh. Lengths display in mm with 2 decimals, angles in degrees with 1 decimal.
- Above 20,000 faces, the record keeps per-part data only, sets `"faces_truncated": true`, and the UI says so.
- `inspect.json` has its own size cap of 4 MiB inside the 15 MiB artifact total.
- Demo viewers can read the record, pick, measure and cut. They cannot highlight in others' viewers.
- `manufacturing_approval` stays `"not_reviewed"`.
- Stability with any part lacking a density is labelled `assumes uniform density`.
- Commit as `ichen27 <ivan27chen@gmail.com>`, with no AI attribution. The full check is `npm run check`.

## Review Focus

1. **A click on an edge between two faces:** picks one of them deterministically (the nearest surface, ties broken by lower index). It never returns nothing on a solid part. Tested in Task 4.
2. **A build with a free-form script (no steps, no declarations):** the record still has parts, faces and pairs, and the panels show no "declared" sections. Tested in Task 1.
3. **A part whose bottom is curved (sphere):** the footprint is a point or very small, so stability reports a tip angle of 0. It does not crash. Tested in Task 2.
4. **Two parts with the same label:** pairs and part data are keyed by index, the duplicate is reported as a warning in the record, and the UI shows both. Tested in Task 2.
5. **A demo viewer calling `view_highlight`:** refused with 403, with nothing broadcast. Tested in Task 6.

---

### Task 1: Inspection record — parts, faces, holes, thickness

**Files:**

- Create: `engine/lib/mantel/inspect.py`, `engine/tests/test_inspect.py`
- Modify: `engine/runner.py`, which writes `inspect.json` after `facts.json` for full builds (not previews). `engine/service.py` adds `inspect.json` (`application/json`) to `FILES`.

**Interfaces:**

- `inspect_record(shape: bd.Shape, module) -> dict` returns:
  ```python
  {"version": 1, "units": "mm", "warnings": [str],
   "parts": [{"index": int, "label": str, "volume": float, "area": float,
              "bbox": {"min": [x,y,z], "max": [x,y,z]}, "center_of_mass": [x,y,z]}],
   "faces": [{"index": int, "part": int, "type": "plane|cylinder|cone|sphere|torus|other", "area": float,
              "center": [..], "bbox": {...},
              "plane"?: {"origin": [..], "normal": [..]},
              "cylinder"?: {"origin": [..], "axis": [..], "radius": float},
              "cone"?: {"origin": [..], "axis": [..], "half_angle_deg": float},
              "sphere"?: {"center": [..], "radius": float}, "torus"?: {"major": float, "minor": float},
              "thickness"?: float}],        # planar faces: distance through the part along -normal
   "holes": [{"part": int, "faces": [int], "diameter": float, "axis": {"origin": [..], "direction": [..]},
              "depth": float, "through": bool}],
   "faces_truncated": bool}
  ```
- Face index is the position in `part.faces()` order, counted across parts. The same order is used by `dimensions()` resolution in Task 2.
- Holes are cylindrical faces whose surface normal points toward their axis (material outside), grouped by coaxial axis and equal radius. `through` is true when the hole opens at both ends of its extent.
- Thickness casts a ray from the face centre along −normal and measures to the first exit of the same part. It is absent when the ray misses.

- [ ] **Step 1: Write the failing tests:**
  - `test_block_faces_are_exact`: a 40×20×30 box gives 6 plane faces, areas exact to 1e-6, normals axis-aligned, and thickness 30 on top and 40 on the left side.
  - `test_tube_hole_and_boss`: a box with a through hole of diameter 5 and a blind hole of diameter 4 and depth 6 gives two holes with those diameters, depths 10 and 6, and through True and False. A boss (a cylinder joined on top) is not a hole.
  - `test_filleted_box_reports_fillet_radius`: the fillet faces are cylinders with radius 2.
  - `test_free_script_still_records`: `examples/bridge.py` has parts, faces and no warnings, and the record is valid JSON under 4 MiB.
  - `test_face_cap_truncates`: with `max_faces=10`, a 30-face model gives `faces_truncated=True` and `faces=[]`.
- [ ] **Step 2: Run** `uv run --project engine pytest engine/tests/test_inspect.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** using build123d `faces()`, `geom_type`, `radius`, `axis_of_rotation`, `normal_at`, `center()`, `bounding_box()` and `Solid.find_intersection_points`, or the OCCT `BRepIntCurveSurface` ray for thickness.
- [ ] **Step 4: Run** the engine suite and ruff. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Record exact part and face measurements with every build"`.

### Task 2: Pairs, declared dimensions, materials, embeds and stability

**Files:**

- Modify: `engine/lib/mantel/inspect.py`
- Create: `examples/deal_toy_inspect.py`. This is the spec's validation fixture: an acrylic block (density 1.19) with an off-centre brass coin (density 8.5, 1.5 mm from the block's front face), standing on a base. The block is tall enough to tip at a known angle, and one engraving is 0.3 mm against a declared 0.5 mm.
- Test: `engine/tests/test_inspect.py`

**Interfaces (record additions):**

- **`pairs`:** `[{"a": int, "b": int, "distance": float, "overlap_volume": float}]` for parts a < b. Only the first 30 parts are paired; beyond that the record gets a `pairs_truncated` warning.
- **`dimensions`:** `[{"name", "param"?, "value": float, "faces": [int, int], "moves"?: int, "matches_param": bool, "scale": float}]`.
  - These come from an optional `dimensions(shape)` function in the script.
  - `value` is the distance between the two faces: the plane-offset difference for parallel planes, otherwise the shape distance.
  - `matches_param` holds when `abs(value - PARAMS[param].value * scale) < 1e-3`.
  - Unresolvable entries become warnings.
- **`materials`:** `{"<label>": {"name": str, "density_g_cm3": float}}`, from a top-level `MATERIALS`.
- **`embeds`:** `[{"part": int, "in": int, "contained": bool, "wall": float}]`, from a top-level `EMBEDS` of `{"part": label, "in": label}`. `wall` is the minimum distance from the embed to the host's outer shell.
- **`stability`:** `{"center_of_mass": [..], "uniform_density": bool, "footprint": [[x, y], ...], "tip_angle_deg": float, "tip_direction": [x, y]}`.
  - The centre of mass is weighted by density when every part has one; otherwise it is the uniform-density centroid.
  - The footprint is the convex hull of the vertices of downward-facing planar faces within 0.01 mm of the lowest Z.
  - The tip angle is the minimum over hull edges of `atan2(distance from the COM projection to the edge, COM height above the floor)`, and 0 when the projection is outside the hull.
- **Duplicate labels** add a warning `Two parts are labelled "X"`.

- [ ] **Step 1: Write the failing tests:**
  - `test_pairs_distance_and_overlap`: two boxes 5 mm apart give distance 5 and overlap 0. Two boxes overlapping by 1×10×10 give overlap 100.
  - `test_declared_dimension_value_and_mismatch`: a wall-thickness declaration on a 4 mm wall with `WALL_T` 4 gives value 4 and `matches_param` True. With `WALL_T` 5, `matches_param` is False.
  - `test_deal_toy_fixture`:
    - the stability tip angle equals the analytic `atan(half-width / COM height)` to 0.1°, computed in the test from the fixture's numbers;
    - the embed wall is 1.5;
    - the engraving dimension is 0.3;
    - `uniform_density` is False;
    - removing one density gives `uniform_density` True.
  - `test_sphere_on_table_does_not_tip_check_crash`: the tip angle is 0, and there are no exceptions.
  - `test_duplicate_labels_warn`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the engine suite and ruff, both locally and in the CAD image. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Measure part pairs, declared dimensions, embeds and stability"`.

### Task 3: Store and serve the record; `inspect_get`

**Files:**

- Modify: `src/server/builds.ts`:
  - the artifact enum and `media` gain `inspect.json`;
  - full builds expect 5 artifacts, and previews still expect 2;
  - check builds expect 5;
  - `inspect.json` is limited to 4 MiB and validated with `inspectSchema`, a zod schema for the top-level shape with `passthrough` on items.
- Modify: `src/server/index.ts`. `GET /api/artifacts/:id` serves `inspect.json` with read access, as it does the GLB.
- Create: `src/server/inspect-tools.ts`, with `inspect_get({ jobId, parts?: number[], faces?: number[], sections?: string[] })` (read access). It returns the record or the requested slices: `parts`, `faces`, `holes`, `pairs`, `dimensions`, `embeds`, `stability` and `warnings`.
- Test: `src/server/inspect.test.ts`, using the mock container with a 5-artifact result.

- [ ] **Step 1: Write the failing tests:**
  - a build stores `inspect.json`;
  - `inspect_get` returns all sections or a slice;
  - a demo viewer can read it;
  - another member's private project gives 404;
  - an over-size record fails the build with a clear error;
  - preview jobs still accept 2 artifacts.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Store the inspection record and let agents read it"`.

### Task 4: Face picking in the viewer

**Files:**

- Create: `src/web/inspect.ts`, which holds the pure functions and record types.
- Modify: `src/web/Viewer.tsx`:
  - `onSelect` also reports the world hit point;
  - a new `highlights` prop takes `{ faces: number[]; parts: string[]; tone: "pick" | "agent" }`;
  - overlays are drawn from record geometry: a translucent quad for a plane face bounded by its bbox, a cylinder shell for a cylindrical face, and a box outline otherwise.
- Modify: `src/web/Workspace.tsx`, which fetches `inspect.json` for the shown build. Click selects a face; shift-click adds a second selection; the breadcrumb switches between face, part and model.
- Test: `src/web/inspect.test.ts`

**Interfaces:**

```ts
export type InspectRecord = {
  version: 1;
  parts: PartRecord[];
  faces: FaceRecord[];
  holes: HoleRecord[];
  pairs: PairRecord[];
  dimensions: DimensionRecord[];
  embeds: EmbedRecord[];
  stability?: StabilityRecord;
  warnings: string[];
  faces_truncated: boolean;
};
export function pickFace(
  record: InspectRecord,
  partLabel: string,
  hit: [number, number, number],
): number | null;
export function surfaceDistance(
  face: FaceRecord,
  p: [number, number, number],
): number; // exact for plane/cylinder/sphere, bbox distance otherwise
```

`pickFace` considers the part's faces whose bbox, expanded by 0.1 mm, contains the hit. It returns the face with the smallest `surfaceDistance`, ties going to the lower index.

- [ ] **Step 1: Write the failing tests:**
  - a hit on a box's top picks the top face;
  - a hit inside a hole picks the hole wall;
  - a hit on the edge between two faces picks a deterministic one;
  - a part not in the record gives `null`;
  - a truncated record gives `null`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run typecheck` and `npm run build`.
- [ ] **Step 4: Commit** `git commit -m "Pick faces from the exact inspection record"`.

### Task 5: Inspect panel, two-selection measure and section view

**Files:**

- Create: `src/web/InspectPanel.tsx`. Modify `src/web/Workspace.tsx` to show it in place of `PartPopover` when a face or second selection exists. The part view keeps the parameters.
- Modify: `src/web/Viewer.tsx`, adding `section?: { axis: "x" | "y" | "z" | "face"; offset: number; normal?: [n, n, n] }`. It applies a clipping plane to the model and fills the cut with stencil caps in the part colour. A toolbar button and slider set it.
- Modify: `src/web/inspect.ts`:
  - `faceSummary(record, index): { title: string; rows: [label, value][] }`, covering type, area, normal or diameter or radius, thickness, and the hole depth and through state;
  - `measureBetween(record, a: Selection, b: Selection): { label: string; value: string } | { label: string; unavailable: string }`. Part–part uses the pair's distance and overlap. Parallel planes use the exact plane offset. Coaxial cylinders give the radial gap. Anything else gives `unavailable: "Needs an exact measure (coming with checks)"`.
- Test: `src/web/inspect.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the summary rows for a plane, a hole wall and a fillet;
  - between parallel faces 4 mm apart gives `4.00 mm`;
  - between two parts gives the distance and the overlap;
  - between a cylinder and a plane gives unavailable.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify in the app** with local `wrangler dev` and the CAD container, on `examples/deal_toy_inspect.py`:
  - click the coin and read its diameter;
  - click the block front and read its thickness;
  - shift-click the coin and the block front to see the distance;
  - section along Y to see the coin's wall;
  - check light, dark and 390 px.

  Save a screenshot to `docs/images/workspace-inspect.png`.

- [ ] **Step 5: Commit** `git commit -m "Inspect faces, measure between selections and cut sections"`.

### Task 6: `view_highlight` through the live relay

**Files:**

- Modify: `src/server/inspect-tools.ts`, adding `view_highlight({ sessionId, jobId, faces?: number[], parts?: string[], message?: string })`. It needs write access to the project and a session on it. It broadcasts `{ type: "highlight", jobId, faces, parts, message, by }` through `notify`, records an `agent_update` event with the message, and changes no model.
- Modify: `src/web/api.ts`, adding the `LiveMessage` variant. Modify `src/web/Workspace.tsx` to show agent highlights in the agent tone, with the message as a toast, cleared on the next click.
- Test: `src/server/inspect.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the broadcast payload (spy on `LIVE`);
  - the event is recorded;
  - a demo viewer is refused with 403 and nothing is broadcast;
  - a session on another project is refused.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Let the agent highlight faces and parts for the team"`.

### Task 7: Skills, docs and PR

**Files:**

- Create: `skills/inspecting/SKILL.md`, registered in `src/server/skills.ts`. It covers reading `inspect_get` after a build, reporting stability, embed walls and declared dimensions with their values, using `view_highlight` to point at what it means, and treating `assumes uniform density` as unknown.
- Modify: `skills/modeling/SKILL.md` (version 3). Declare `dimensions()` for every distance-like parameter, plus `MATERIALS` and `EMBEDS` for deal toys.
- Modify: `README.md`, `docs/validation.md` and `examples/README.md`.
- [ ] **Step 1: Run** `npm run check` and the engine tests in the CAD image. Expected: PASS.
- [ ] **Step 2: Review the branch**, then push and open the PR "Inspect: exact measurements, picking and sections". Merge only after green with `--match-head-commit`. Watch the deploy, then check `/health` for the merge release.
