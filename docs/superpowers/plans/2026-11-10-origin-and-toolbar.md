# Origin planes and the floating tool bar: implementation plan 1 of 4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visible, pickable origin planes, a floating tool bar and command search generated from the action catalog, a Browser card, a corner triad, and step tools that start from an empty model.

**Architecture:** The origin planes are built-in construction planes (`XY`, `XZ`, `YZ`) in the engine's `Model`, so existing `m.datum(...)` references and plane inputs take them with no new reference type. The browser draws the origin from pure model-frame geometry (`origin.ts`) through the existing `toScene` mapping, and the tool bar groups come from two new catalog fields (`group`, `featured`). Step tools write a starter script when a model has no revision yet.

**Tech Stack:** Python 3.12 + build123d (engine), TypeScript on Cloudflare Workers (server), React 19 + Three.js 0.187 (web), Vitest and pytest.

**Spec:** `docs/superpowers/specs/2026-11-10-cad-workspace-tools-design.md`. This plan covers the sections "The screen (layout B)", "Origin planes and axes", "The tool bar is the catalog" and "Starting from an empty model". Plan 2 covers the sketch engine and the `sketch` action, plan 3 the browser sketch editor and sketch-driven extrude and revolve (with axis picking), and plan 4 pattern and mirror.

## Global Constraints

- Origin plane names are exactly `XY`, `XZ`, `YZ`; axes are `X`, `Y`, `Z`.
- Plane colours follow their normal axis: XY blue `0x3b82f6`, XZ green `0x22c55e`, YZ red `0xef4444`. Axes: X red, Y green, Z blue, the same three values.
- Sketch-plane axes: XY is X right, Y up; XZ is X right, Z up; YZ is Y right, Z up. These are build123d's `Plane.XY`, `Plane.XZ` and `Plane.YZ`.
- Tool bar group order: `Sketch, Create, Modify, Arrange, Construct, Custom`. No group or button appears without an implemented action, so `Sketch` stays hidden until plan 2.
- Agents still need a design sheet and an open change plan to write (the guard is unchanged); people's edits are never blocked.
- Verify UI at 1440 × 900 and 390 × 844, in both themes, with no horizontal scroll.
- Commit as `ichen27 <ivan27chen@gmail.com>`; one PR for this plan, merged only after the required `test` check passes.

## Review Focus

- **Origin with no build yet.** An empty model has no record or mesh, so the overlay must still draw at a 1 mm = 1 unit scale, with no crash before the first build. Pinned in Task 3 (`originPlanes(null)`).
- **A user step named like an origin plane.** It must fail with `duplicate_name`, not shadow the origin. Pinned in Task 1.
- **The dropdown and a pick must agree.** Choosing "XY" from "or a plane…" and clicking the XY plane must produce the same `{ref:"datum",name:"XY"}`. Pinned in Task 3 (`originPickRef`).
- **Free-form models.** A model whose source has no steps section must still refuse tools with the existing message, not get a starter script written over its code. Pinned in Task 2.
- **Saved custom actions.** They must still appear, under Custom, and search must find them. Pinned in Task 5 (`toolbarGroups` and `searchActions` cases).

---

### Task 1: Origin planes as built-in construction planes (engine)

**Files:**

- Modify: `engine/lib/mantel/model.py` (`Model.__init__`)
- Modify: `engine/tools/gen_catalog.py` (descriptions that mention construction planes), then regenerate `engine/lib/mantel/catalog.json`
- Modify: `src/server/step-tools.ts` (the `steps_add` description's reference list)
- Test: `engine/tests/test_mantel.py`

**Interfaces:**

- Produces: `Model.datums` starts as `{"XY": bd.Plane.XY, "XZ": bd.Plane.XZ, "YZ": bd.Plane.YZ}`; `ORIGIN_PLANES = ("XY", "XZ", "YZ")` exported from `mantel.model`.

- [ ] **Step 1: Write the failing tests**

```python
def test_origin_planes_resolve_with_standard_axes():
    from mantel.model import Model
    m = Model()
    for name, x, y, z in [("XY", (1, 0, 0), (0, 1, 0), (0, 0, 1)),
                          ("XZ", (1, 0, 0), (0, 0, 1), (0, -1, 0)),
                          ("YZ", (0, 1, 0), (0, 0, 1), (1, 0, 0))]:
        plane, label, faces = m.resolve_plane(m.datum(name))
        assert (label, faces) == (None, [])
        assert tuple(plane.x_dir) == pytest.approx(x)
        assert tuple(plane.y_dir) == pytest.approx(y)
        assert tuple(plane.z_dir) == pytest.approx(z)
        assert tuple(plane.origin) == pytest.approx((0, 0, 0))


def test_steps_build_from_origin_planes(tmp_path):
    facts = run(tmp_path, script([BLOCK, 'm.plane("Lift", method="offset", reference=m.datum("XY"), distance=10)']))
    assert states(facts) == {"Block": "ok", "Lift": "ok"}


def test_origin_plane_names_are_reserved(tmp_path):
    facts = run(tmp_path, script([BLOCK, 'm.plane("XY", method="offset", reference=m.datum("XZ"), distance=1)']))
    assert step(facts, "XY")["state"] == "failed"
    assert step(facts, "XY")["code"] == "duplicate_name"
```

Use the error field name the existing `test_duplicate_name_fails` asserts on, if it isn't `code`.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --project engine pytest engine/tests/test_mantel.py -q -k origin`
Expected: 3 failed (`datum_not_found`).

- [ ] **Step 3: Seed the datums in `Model.__init__`** before `base` is read. In `gen_catalog.py`, every reference description that says "construction plane" should add "or an origin plane (XY, XZ, YZ)". In `steps_add`'s description, `{ref:'datum',name}` becomes `{ref:'datum',name}` for a construction plane's step name or `XY`/`XZ`/`YZ`. Regenerate the catalog with the command in `gen_catalog.py`'s docstring.

- [ ] **Step 4: Run the engine suite**

Run: `uv run --project engine pytest engine/tests -q`
Expected: all pass, including `test_stored_worker_fixtures_are_current` (regenerate fixtures with `engine/tools/gen_fixtures.py` only if it fails because of the new descriptions).

- [ ] **Step 5: Commit** `Origin planes XY, XZ and YZ as built-in construction planes`.

### Task 2: Step tools start an empty model (server)

**Files:**

- Modify: `src/server/actions/script.ts` (export the starter source)
- Modify: `src/server/step-tools.ts` (`change`)
- Test: `src/server/steps.test.ts`

**Interfaces:**

- Produces: `export const STARTER_SOURCE: string` in `script.ts`. It is the standard layout with `PARAMS = {}`, a `base()` returning `None`, `m = mt.Model(base(), params=PARAMS)`, empty step markers, and `return m.result()`, shaped exactly like `script([])` in `engine/tests/test_mantel.py`.

- [ ] **Step 1: Write the failing tests** in `describe("action and step tools")`:
  - `"steps_add on a model with no revision saves revision 1 in the standard layout"`: create a model and call `steps_add` with `expectedRevision: 0`, `action: "body"`, `name: "Block"` and box inputs. Expect revision 1 to exist, `readSteps(source).steps.map(s => s.name)` to equal `["Block"]`, and the source to start with `STARTER_SOURCE`'s first line.
  - `"steps_add still refuses a free-form model"`: save a source without markers as revision 1, then `steps_add` with `expectedRevision: 1`. Expect status 400 and the existing no-steps-section message.
  - `"an agent still needs a design sheet on an empty model"`: the same `steps_add` through `dispatch(..., "mcp")` with no design sheet is refused the way the guard refuses other agent writes. Copy the expected status and message from the existing guard test in `design.test.ts`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/server/steps.test.ts -t "empty|free-form|design sheet on an empty"`
Expected: the first fails with 404 "Revision not found"; the other two may already pass.

- [ ] **Step 3: In `change`,** when `i.expectedRevision === 0` and no revision row exists, use `STARTER_SOURCE` instead of throwing 404. Everything after `readSteps` stays the same.

- [ ] **Step 4: Run** `npx vitest run src/server` and expect all to pass.

- [ ] **Step 5: Commit** `Step tools start an empty model in the standard layout`.

### Task 3: Origin overlay and plane picking (web)

**Files:**

- Create: `src/web/origin.ts`, `src/web/origin.test.ts`
- Modify: `src/web/Viewer.tsx` (new `origin` prop and picking), `src/web/Workspace.tsx` (`planeNames`, `pickIntoForm`, visibility state)

**Interfaces:**

- Produces, in `origin.ts`:
  - `type OriginPlane = "XY" | "XZ" | "YZ"; type OriginAxis = "X" | "Y" | "Z"; type OriginItem = OriginPlane | OriginAxis;`
  - `ORIGIN_COLORS: Record<OriginItem, number>` (values from Global Constraints)
  - `originHalfSize(bounds: { min: Vec3; max: Vec3 } | null): number`: 60 mm when `null`; otherwise `max(60, 0.6 × the largest absolute coordinate of bounds)`.
  - `originPlanes(bounds: { min: Vec3; max: Vec3 } | null): { name: OriginPlane; corners: [Vec3, Vec3, Vec3, Vec3]; color: number }[]`, model frame, centred on the origin.
  - `originAxes(bounds): { name: OriginAxis; from: Vec3; to: Vec3; color: number }[]`, from −half to +half.
  - `originVisible(item: OriginItem, ctx: { hasParts: boolean; pickingPlane: boolean; overrides: Partial<Record<OriginItem, boolean>> }): boolean`: the override wins; otherwise visible when `!hasParts || pickingPlane`.
  - `originPickRef(name: OriginPlane): { ref: "datum"; name: OriginPlane }`
- Produces, in `Viewer.tsx`: prop `origin?: { visible: Record<OriginItem, boolean>; bounds: { min: Vec3; max: Vec3 } | null; pickPlanes: boolean; onPickPlane: (name: OriginPlane) => void }`.

- [ ] **Step 1: Write `origin.test.ts`:**
  - `originHalfSize(null)` is 60, and is 120 for bounds max `[200, 10, 10]`.
  - Every XY corner has z 0, every XZ corner y 0, every YZ corner x 0, and each plane's corners span ±half on its two in-plane axes.
  - The colours of XY, XZ and YZ are `0x3b82f6`, `0x22c55e` and `0xef4444`; X, Y and Z use the same three values.
  - `originVisible`: true on an empty model, false once there are parts, true again while picking a plane, and an override of `false` hides it on an empty model.
  - `originPickRef("XZ")` deep-equals `{ ref: "datum", name: "XZ" }`.

- [ ] **Step 2: Run** `npx vitest run src/web/origin.test.ts`. Expected: fails, module not found.

- [ ] **Step 3: Implement `origin.ts`,** then the Viewer group. Draw translucent plane meshes (opacity about 0.12, double-sided, `depthWrite: false`) with an edge outline, and the three axis lines, all converted with `toScene`. Add the group to the loaded object when there is one, so it shares the model's frame. Otherwise add it to the scene at scale 1. In the existing `onUp` click handler, when `origin.pickPlanes` is true, raycast the plane meshes before the model and call `onPickPlane`. In `Workspace`:
  - `planeNames` becomes `["XY", "XZ", "YZ", ...construction plane step names]`.
  - When the active form field's `refKinds` includes `"datum"`, `pickPlanes` is true, and `onPickPlane` fills the field through the same `applyPick` path, with `originPickRef(name)`.
  - Visibility overrides live in component state.

- [ ] **Step 4: Run** `npx vitest run src/web` and `npm run typecheck`. Expected: pass.

- [ ] **Step 5: Commit** `Draw the origin planes and axes, and pick a plane into a form`.

### Task 4: Corner triad (web)

**Files:**

- Create: `src/web/triad.ts`, `src/web/triad.test.ts`, `src/web/Triad.tsx`
- Modify: `src/web/Viewer.tsx` (report the camera orientation), `src/web/style.css`

**Interfaces:**

- Produces: `triadVectors(cameraQuaternion: [number, number, number, number]): Record<OriginAxis, [number, number]>`. It gives each model axis's on-screen direction, x right and y up, with length 1 when the axis lies in the screen and near 0 when it points at the viewer. It maps model axes through `toScene(…, 1)`, then through the inverse camera rotation.
- Produces: Viewer prop `onView?: (q: [number, number, number, number]) => void`, called when the orbit controls report a change.

- [ ] **Step 1: Write `triad.test.ts`.** For a camera looking straight down the model's −Z, X points to `[1, 0]`, Y to `[0, 1]`, and Z has length under 0.01. For the default camera (`position.set(160, 110, 180)` looking at the origin), Z's y component is positive (Z points up on screen).
- [ ] **Step 2: Run** `npx vitest run src/web/triad.test.ts`. Expected: fails.
- [ ] **Step 3: Implement** `triadVectors`, and `Triad.tsx`: a 56 px SVG in the view's top-right corner with three labelled coloured lines (`ORIGIN_COLORS`), drawn back to front. It updates through a ref, so camera motion doesn't re-render the workspace.
- [ ] **Step 4: Run** the web tests and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `Show a triad of the model axes in the corner of the view`.

### Task 5: Catalog groups, the floating tool bar and command search (catalog + web)

**Files:**

- Modify: `engine/tools/gen_catalog.py` (records gain `group` and `featured`), regenerate `catalog.json`
- Modify: `src/server/actions/catalog.ts` (`ActionRecord` gains `group?: ToolbarGroup; featured?: boolean`), `src/server/actions/catalog.test.ts`
- Create: `src/web/toolbar-groups.ts`, `src/web/toolbar-groups.test.ts`, `src/web/CommandSearch.tsx`
- Modify: `src/web/Toolbar.tsx` (becomes the floating bar), `src/web/Workspace.tsx`, `src/web/style.css`

**Interfaces:**

- Produces: `type ToolbarGroup = "Sketch" | "Create" | "Modify" | "Arrange" | "Construct" | "Custom"` exported from `catalog.ts`. Records set `group` only when it differs from `category`. `combine` and `appearance` take `group: "Modify"`. The featured actions are `body`, `extrude`, `hole`, `fillet`, `chamfer`, `shell`, `move` and `plane`.
- Produces, in `toolbar-groups.ts`:
  - `toolbarGroups(actions: ToolbarAction[]): { group: ToolbarGroup; featured: ToolbarAction[]; more: ToolbarAction[] }[]`, in the Global Constraints order. It omits empty groups. An action's group is its `group ?? category`.
  - `searchActions(actions: ToolbarAction[], query: string): ToolbarAction[]`. It is case-insensitive over title, id and summary. Title-prefix matches come first, then other title matches, then id and summary matches. An empty query returns nothing.
- `ToolbarAction` gains `group?` and `featured?`. Saved actions arrive with `category: "Custom"` and no `featured` flag.

- [ ] **Step 1: Write the failing tests.**
  - `catalog.test.ts`: `"every record's group is a tool bar group"`, and `"the featured actions are body, extrude, hole, fillet, chamfer, shell, move and plane"`.
  - `toolbar-groups.test.ts`:
    - for the built-in catalog plus one saved action, the group names equal `["Create", "Modify", "Arrange", "Construct", "Custom"]`
    - `combine` is under Modify
    - Create's featured list is `body`, `extrude` and `hole`
    - the saved action is in Custom's `more`
    - `searchActions(all, "fil")` starts with `fillet`
    - `searchActions(all, "bevel")` finds `chamfer` by its summary
    - `searchActions(all, "<saved id>")` finds the saved action
    - `searchActions(all, "")` is empty
- [ ] **Step 2: Run** `npx vitest run src/server/actions/catalog.test.ts src/web/toolbar-groups.test.ts`. Expected: fails.
- [ ] **Step 3: Implement it.**
  - **Records:** add the fields in `gen_catalog.py` and regenerate.
  - **Toolbar.tsx:** renders `toolbarGroups(...)` as one floating bar, top centre (layout B). Each group shows its featured actions as buttons and a "▾" menu listing the rest, with each action's summary as its tooltip. The bar keeps the current props (`actions`, `disabledReason`, `onOpen`, `onChoose`); `disabledReason` disables every button and shows as the bar's tooltip.
  - **Phone width** (the existing 760 px breakpoint): only one button per group shows, which opens that group's full list.
  - **CommandSearch.tsx:** the search chip in the top-right bar. It opens a field and a result list from `searchActions`. Enter or a click calls `onChoose(id)`, and Escape closes it.
  - **Toolbar reason in `Workspace`:** a model at revision 0 is no longer refused for having no steps section, because Task 2 starts it.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `Floating tool bar and command search, grouped from the catalog`.

### Task 6: Browser card (web)

**Files:**

- Create: `src/web/BrowserPanel.tsx`, `src/web/browser-tree.ts`, `src/web/browser-tree.test.ts`
- Modify: `src/web/Workspace.tsx`, `src/web/style.css`

**Interfaces:**

- Consumes: `OriginItem` and `originVisible` (Task 3).
- Produces: `browserTree(input: { parts: string[]; steps: { name: string; action: string }[] }): { folder: "Origin" | "Bodies" | "Construction"; items: { id: string; label: string }[] }[]`.
  - Origin always lists `XY`, `XZ`, `YZ`, `X`, `Y`, `Z`.
  - Bodies lists the part labels.
  - Construction lists the `plane` steps.
  - A folder other than Origin with no items is omitted.
- Produces: `BrowserPanel` props `{ tree; visible: Record<OriginItem, boolean>; onToggle: (item: OriginItem) => void; selected: string | null; onSelectBody: (label: string) => void; onOpenStep: (name: string) => void }`.

- [ ] **Step 1: Write `browser-tree.test.ts`.** An empty model gives only Origin, with six items. A model with parts `Base` and `Coin` and a `plane` step `Mid plane` gives Origin, then Bodies `[Base, Coin]`, then Construction `[Mid plane]`.
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement it.**
  - **Card:** a collapsible card on the left, under the top bar (layout B). It is collapsed by default on phones, and its open/closed state is saved in `localStorage`, with reads and writes wrapped in try/catch.
  - **Origin eyes:** they toggle the overrides from Task 3.
  - **Bodies:** a click selects the part, the way clicking it on the model does.
  - **Construction:** a click opens the step, the way clicking it in the timeline does.
  - **Position:** the activity feed stays bottom left, and the card must not overlap it at 1440 × 900 or 390 × 844.
  - **Timeline:** move the step timeline (`Timeline`, today a row of chips under the top bar) to float at the bottom centre, beside the revision chips, as layout B puts it. Its behaviour is unchanged.
- [ ] **Step 4: Run** the web tests and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `Browser card with the origin, bodies and construction planes`.

### Task 7: Verify in the app, document, open the PR

**Files:**

- Modify: `README.md`, `docs/validation.md`
- Create: `docs/images/workspace-origin.png`, `docs/images/workspace-toolbar.png`, `docs/images/workspace-toolbar-mobile.png` (synthetic data only)

- [ ] **Step 1: Run** `bash ci/run.sh`. Expected: it exits 0, with the Worker, Python, format, types, build, audit and dry-run checks all passing.
- [ ] **Step 2: Check it in the app.** Run local `wrangler dev` against a scratch `--persist-to` directory, with migrations applied and a synthetic owner signed in. At 1440 × 900 and 390 × 844, in light and dark, check each of these:
  - **Empty model:** a new empty project shows the three planes, the axes and the triad.
  - **Starting from the tool bar:** choosing **Body** from the bar adds the first step (Task 2), and after the build the planes hide.
  - **Picking a plane:** opening **Construction plane** with method offset, then clicking the XY plane, fills the reference with `XY`, and choosing it from the dropdown gives the same value.
  - **Search:** "fil" finds Fillet.
  - **Browser:** the eyes toggle the planes and axes.
  - **Layout:** there's no horizontal scroll.

  Take the three screenshots.

- [ ] **Step 3: Document it.** Add a `docs/validation.md` entry in the existing style: what changed, the tests, the in-app checks, and known limits (axes aren't pickable until plan 3; Sketch is hidden until plan 2). In `README.md`, replace the "+ Add step" sentence with the floating tool bar, the origin planes and command search.
- [ ] **Step 4: Commit, push and open the PR.** The PR needs Problem, Change, Validation and Risk sections. Merge only after the required `test` check passes on the PR's current commit, then confirm production `/health` reports the merge commit.
