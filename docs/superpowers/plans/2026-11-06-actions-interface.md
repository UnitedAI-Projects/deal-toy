# Actions Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person uses the same self-describing actions the agent uses. A toolbar generated from the catalog opens a form generated from the action's input schema. Clicking the model fills selection fields with stable references. A ghost preview shows the result before committing, and presets fill or save inputs. The timeline edits and reorders steps. The agent's model summary includes what the person has selected.

**Architecture:**

- **Engine names.** The engine adds, to each face in the inspection record, the step-created names and part sides that resolve to it. The browser turns a pick into the most stable reference: a created name, then a side, then a `normal`/`near` query.
- **Generated forms.** Forms are derived from the catalog record and its schema (types, enums, units, ranges, defaults, `x-ref` and `allOf` conditions). The Worker stays the validator.
- **Ghost previews.** These are pure geometry from the form values, drawn with the inspect overlays.
- **Selection.** The person's selection is stored per member and model, so `modelContext` can include it.

**Tech Stack:** React 19, three.js, vitest; Worker and D1; engine Python.

**Spec:** `docs/superpowers/specs/2026-11-05-modeling-actions-design.md`, sections "References that survive rebuilds", "Interface" and "What the agent always sees". Builds on #30, #31 and #32.

## Global Constraints

- The interface shows only actions and fields from the catalog or saved records. No form field exists that the schema does not describe.
- A pick never becomes a face index in the script: always a created name, a side, or a `normal`/`near` query.
- Ghost previews are labelled "preview" and replaced by the build. They are approximate by design.
- Demo viewers see the toolbar disabled, with the reason, and can't save presets or edit steps.
- The commit identity and attribution rules are as before. The full check is `npm run check`.

## Review Focus

1. **A pick on a face that two steps' created names both match** (a wall split by a later step): the reference uses the first name in step order, deterministically. Tested in Task 1.
2. **A form for a variant whose required fields appear only for one value** (hole counterbore): switching the variant shows and hides those fields, and hidden values are not submitted. Tested in Task 2.
3. **A number field given a parameter instead of a number** (`HOLE_D`): the form offers the model's parameters for any mm field and submits `{param}`. Tested in Task 2.
4. **Dragging a timeline step to before the step it depends on:** the move is saved and the build shows it as blocked or failed, as the spec allows. The UI does not prevent it. Tested in Task 5.
5. **A stale selection after a rebuild** (the picked face index no longer exists): the panel clears it, and `selection_set` stores references, not indices. Tested in Task 6.

---

### Task 1: Names in the record, and references from picks

**Files:**

- Modify: `engine/lib/mantel/model.py`, adding `mt.last_model()` to expose the last `Model`. Modify `engine/lib/mantel/inspect.py`: each face gains `names: [{"of": str, "name": str}]` (created names, in step order) and `sides: [str]` (part sides from `geometry.side_faces`).
- Create: `src/web/refs.ts`, exporting `refFromPick(record: InspectRecord, face: number): Ref`.
- Test: `engine/tests/test_inspect.py` and `src/web/refs.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - **Engine:** on the deal-toy steps fixture, the Mount hole wall face has `names` `[{"of": "Mount hole", "name": "wall"}]`, and Base's bottom face has `sides` `["bottom"]`.
  - **Web:**
    - a face with names gives `{ref: "face", of, name}`;
    - one with only sides gives `{ref: "face", of: part, name: side}`;
    - otherwise it gives the `normal`/`near` query with the face centre;
    - with two names, the first is used.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Name faces in the inspection record and turn picks into references"`.

### Task 2: Forms generated from action schemas

**Files:**

- Create: `src/web/forms.ts`. It exports `fieldsFor(action, values): Field[]` and `submitValues(action, values): Record<string, StepValue>`. A `Field` is `{ name, label, description, kind: "number" | "integer" | "text" | "choice" | "flag" | "vec3" | "ref" | "list", unit?, min?, max?, default?, options?, refKinds?, required: boolean, visible: boolean }`. Fields required only under an `allOf` condition are visible only when it holds. Hidden fields are dropped from `submitValues`.
- Create: `src/web/ActionForm.tsx`, which renders the fields. Ref fields show the current reference and a "Pick on model" button. Number fields in mm offer the model's parameters. A preset menu and "Save as preset" are included. Submit calls `steps_add` (or `steps_edit` when editing).
- Test: `src/web/forms.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the hole fields: `on` is a required ref, `diameter` is a number in mm from 0.2 to 200, and `kind` is a choice defaulting to simple;
  - counterbore shows `cb_diameter` and `cb_depth`, while simple hides them and drops them on submit;
  - `extent` through hides `depth`;
  - a parameter value submits `{param}`;
  - `custom` with a saved record uses that record's inputs.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Generate action forms from their schemas"`.

### Task 3: Toolbar, picking into forms, presets

**Files:**

- Create: `src/web/Toolbar.tsx`. Categories come from `actions_list({ projectId })`: built-ins plus saved actions. Hovering shows the summary, and "?" opens the description.
- Modify: `src/web/Workspace.tsx`:
  - an open form takes over clicks: a pick fills the active ref field through `refFromPick`;
  - presets come from `presets_list`;
  - "Save as preset" calls `presets_save` with an id slugged from its name.
- Modify: `src/web/style.css`.
- [ ] **Step 1: Write the failing test:** `src/web/forms.test.ts::"applyPick fills the active ref field and moves to the next empty one"`, using the pure `applyPick(fields, values, active, ref)`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the action toolbar with pick-to-fill forms and presets"`.

### Task 4: Ghost previews

**Files:**

- Create: `src/web/ghost.ts`, exporting `ghostShape(action, values, record): Ghost | null`. A `Ghost` is one of:
  - `{ kind: "plane"; origin; normal; size }`
  - `{ kind: "cylinder"; origin; axis; radius; length }`
  - `{ kind: "box"; min; max }`
  - `{ kind: "prism"; origin; normal; width; length; depth }`

  Values come from the referenced face's record entry and the form's numbers. Unresolved inputs give `null`.

- Modify: `src/web/overlays.ts` to add `ghostObject(ghost, scale)`, a dashed, translucent mesh in the agent-neutral tone. Modify `src/web/Viewer.tsx` with a `ghost` prop, labelled "preview" in the form.
- Test: `src/web/ghost.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - a hole on a top face at a point gives a cylinder going down by the depth, or by the part height when the extent is through;
  - a plane offset from a face gives a plane shifted along its normal;
  - a body box gives a box sitting on its face;
  - an extrude cut rectangle gives a prism going into the face;
  - an unresolved `on` gives null.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Preview actions with ghost geometry before committing"`.

### Task 5: Timeline editing and reordering

**Files:**

- Modify: `src/web/Timeline.tsx`:
  - the popover gets "Edit", which opens `ActionForm` with that step's inputs from `steps_list` and saves with `steps_edit`;
  - "Rename" calls `steps_rename`; "Remove" asks for confirmation, then calls `steps_remove`;
  - dragging a chip calls `steps_move`.
- Create: `src/web/reorder.ts`, exporting `moveAfter(names, dragged, target): string | null`. It returns the `after` argument for `steps_move`, or null for the start.
- Test: `src/web/reorder.test.ts`

- [ ] **Step 1: Write the failing tests:** dragging to the first position, to the middle, and onto itself (no move).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Edit, rename, remove and reorder steps from the timeline"`.

### Task 6: The person's selection in the agent's summary

**Files:**

- Create: `migrations/0007_selections.sql`, with `CREATE TABLE selections (model_id TEXT NOT NULL REFERENCES models(id), member TEXT NOT NULL, refs TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(model_id, member))`.
- Modify: `src/server/inspect-tools.ts`, adding `selection_set({ modelId, refs: Ref[] })`. It needs read access, stores at most 4 refs, and an empty list clears the selection.
- Modify: `src/server/actions/summary.ts`, so `modelContext` appends `Selected: face("Base", "bottom") · part("Coin")` from the newest selection by any member in the last 30 minutes.
- Modify: `src/web/Workspace.tsx`, which calls `selection_set` (debounced) when picks change.
- Test: `src/server/inspect.test.ts`, `src/server/actions/summary.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the stored refs appear in the MCP context;
  - a selection older than 30 minutes is left out;
  - an empty list clears it;
  - more than 4 refs is refused;
  - a demo viewer may set their own selection on a demo project, but it is not shown to the owner's agent. Only members with write access are summarised.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Tell the agent what the person has selected"`.

### Task 7: In-app check, docs and PR

- [ ] **Step 1: Check in the app** with local `wrangler dev` and the CAD container, on the deal-toy steps fixture:
  1. Open Modify → Hole.
  2. Click Base's bottom; `on` shows `face("Base", "bottom")`.
  3. Type a diameter, and see the ghost cylinder.
  4. Commit; the timeline shows the new step pending, then ok.
  5. Apply a preset.
  6. Edit the step's diameter from the timeline.
  7. Drag it to the start.
  8. An MCP tool result shows `Selected:`.

  Check light, dark and 390 px. Save `docs/images/workspace-actions.png`.

- [ ] **Step 2: Update docs** (`README.md`, `docs/validation.md`), then run `npm run check` and the engine tests in the CAD image.
- [ ] **Step 3: Review, then push** and open the PR "Actions interface: toolbar, forms, pick-to-fill and previews", stacked on #32.
