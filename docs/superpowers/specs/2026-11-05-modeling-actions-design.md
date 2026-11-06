# Self-describing modeling actions

Status: proposed design, 2026-11-05. Builds on the current foundation (`docs/architecture.md`), the live workspace (`2026-10-28-agent-live-workspace-design.md`) and the proposed inspect design (`2026-11-05-inspect-and-fit-design.md`, PR #28), which supplies face picking.

## Intent

Today a person changes a Mantel model in one of two ways: edit a declared `PARAMS` value, or ask the agent to rewrite the Python. Nothing in between lets someone say "put a 5 mm hole here" or "engrave this text on that face" without writing code. CAD tools such as Fusion offer exactly that in between: a toolbar of modeling operations such as planes, extrudes, holes, fillets, shells, text, combine, pattern and move. Each one has a form, works on what you selected, and adds a step to a timeline you can edit later.

This change gives Mantel such a set of **modeling actions**. One property matters more than any other: **every action describes itself, the way an MCP tool does.** Each action is stored as a record with a name, a summary, guidance on when to use it, a typed and described input schema, the kinds of selection it accepts, what it creates and how it fails. That one record produces:

- the agent's tool description and validation,
- the person's toolbar button, preset form and timeline entry,
- the compact summary of actions and model elements that the agent receives at all times.

Person and agent use the same actions and see each other's steps live.

**The first users are deal-toy makers** (inspect design, 2026-11-05). So the default actions are the ones that build deal toys: blocks and bases, engraved and embossed text, mounting holes, embed cavities, fillets and chamfers, and moving and aligning parts.

## Decisions already made

Decided by the product owner in conversation on 2026-11-05:

- **Planes and manipulations.** Construction planes and operations such as cutting a hole are in scope, alongside the inspect work.
- **Self-describing actions.** "Very important." Every action has a description associated with it, stored with it, as MCP tools carry descriptions on every endpoint. Summaries of the available actions and of the model's elements are provided to the agent at all times.
- **Actions are presets in a shared interface.** The same actions appear as presets in an interface where the person, or the AI, manipulates 3D pieces.
- **Actions write into the script.** Each action inserts or edits one named call in an ordered section of the model's build123d script, for example `m.hole("Mount hole", …)`. Those calls are the timeline. The interface stays build123d code, as decided on 2026-10-28. The agent can still write free Python as a custom step.
- **Custom steps are saved for reuse.** A custom step is stored, with a description, so later sessions and people can find and reuse it.
- **A store of all steps and states.** Mantel keeps a store of every available step and of the states a model and its steps can be in.
- **Start with default actions.** The product owner left the remaining choices to Claude ("just start with default actions"). Everything below marked _(my call)_ is one of those defaults and remains open.

## Goals

1. **One action store.** Every built-in and saved custom action is a record with the fields listed under "The action record". Nothing else defines an action, so a description never exists in two places.
2. **Generated surfaces.** The MCP tool descriptions and input validation, the web toolbar, the preset forms and the agent's context summary are all generated from the store.
3. **Steps in the script.** Adding, editing, suppressing, reordering or removing a step changes only the step section of the script. It saves a new revision through the existing conflict check and rebuilds.
4. **A timeline with health.** Every build reports each step's state and message. The viewer shows the timeline. Clicking a step highlights what it created and opens its form.
5. **Picks fill forms.** Clicking a face, edge, plane or part fills the matching field with a stable reference that survives rebuilds and parameter changes. A reference that no longer resolves fails loudly. It never silently picks a different face.
6. **Steps name what they create**, so later steps, checks and the agent can refer to it by name, for example `face("Mount hole", "wall")`.
7. **Custom steps become actions.** Saving a custom step asks for the same record. It must pass an example build before it joins the store. After that it is a preset and an agent action like any built-in.
8. **Presets.** A preset is a saved set of input values for one action, such as "M3 counterbore" or "0.5 mm engrave". Presets are stored and described like actions.
9. **Ghost previews.** While a form is open, the browser draws an approximate preview without a build. The real build replaces it after commit.
10. **View as of a step.** The person or agent can view the model as it was after any step, built on demand.
11. **Parameters drive steps.** Any numeric input can refer to a `PARAMS` entry, so existing parameter editing, and inspect adjustments A and B, keep working on action-made features.

## Non-goals

- A 2D sketch editor or constraint solver. Profiles come from a fixed set of shapes (rectangle, rounded rectangle, circle, slot, regular polygon, text). Free-form profiles stay custom Python. _(my call)_
- Joints and assembly motion. They are batch 2 of the inspect design.
- Exact, instant previews. Builds run in a fresh container (about 8.5 s to start on a typical host, about 30 s on the slow one, before the model itself builds; `docs/validation.md`). Ghost previews are approximate by design.
- Importing a STEP file and editing its features.
- Changing the build isolation. Custom steps run only inside the existing build container.
- Converting existing free-form scripts automatically.

## Anti-goals

These would make it a failure even if it technically works:

- **A reference that drifts.** A step lands on a different face after a rebuild and nobody is told.
- **A description that lies.** A description that doesn't match the behaviour misleads every future agent session, because the agent trusts it.
- **Edits outside the step section.** An action that reformats or rewrites the person's own Python.
- **An action list the agent can't choose from.** Either too many near-duplicate tools, or summaries too long to fit in every result.
- **Silent partial models.** A build with a failed step must not look like a good model.

## How it works

### The action record

Every action, built-in or custom, is one record:

| Field                               | Purpose                                                                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `version`                     | Stable id such as `hole`, and an integer version. A script call pins the version it was written against.                                                                                                         |
| `title`, `category`                 | Toolbar label and group: Create, Modify, Construct, Combine, Arrange, Custom.                                                                                                                                    |
| `summary`                           | One line, shown in the toolbar tooltip and in the agent's always-on index. At most 120 characters.                                                                                                               |
| `description`                       | When to use it, when not to, and how it differs from similar actions. Shown in the form and in `actions_describe`.                                                                                               |
| `inputs`                            | A JSON Schema object. Every property has a `description`, and numeric ones a `unit` and range. Variants are a `oneOf` with a described discriminator, for example hole `kind`: simple, counterbore, countersink. |
| `selections`                        | Which inputs take a pick, and of what kind: `face`, `edge`, `plane`, `point`, `part`, and how many.                                                                                                              |
| `creates`                           | The names the step gives to what it makes, each described, for example hole creates `wall`, `floor`, and for counterbores `counterbore_wall`.                                                                    |
| `failures`                          | Each way the action can fail, with a code, a plain explanation and the usual fix. For example `face_not_found`: "the face this step was placed on no longer exists; pick it again".                              |
| `preview`                           | The ghost-preview primitive: `plane`, `cylinder`, `prism`, `text`, `bodies`, or `none`.                                                                                                                          |
| `example`                           | One complete example call, used in the description and as the build test for custom actions.                                                                                                                     |
| `scope`, `created_by`, `created_at` | Built-in, project or team; who saved it and when.                                                                                                                                                                |

**Built-in actions** are defined once in a repository catalog file. The Worker bundles it to serve descriptions, and the engine image bundles it to validate calls. A test fails if a catalog entry has no engine implementation or an implementation has no catalog entry. **Custom actions** live in D1 with the same fields plus their Python source, versioned like skills (`skills_save`'s expected-version insert). _(my call: the builder may choose the file format, JSON or TypeScript emitted to JSON.)_

**States are part of the store too.** The step states below, and each action's failure codes, are records with descriptions, so the agent can read what a state means and what fixes it instead of guessing.

### Steps in the script

A model that uses actions has a standard shape. The Mantel helper library ships in the engine image as `mantel`:

```python
import build123d as bd
import mantel as mt

PARAMS = {
    "BLOCK_W": {"value": 80.0, "unit": "mm", "part": "Block", "min": 40, "max": 150},
    "HOLE_D": {"value": 5.0, "unit": "mm", "part": "Base", "min": 2, "max": 10},
}

def base():
    # Free Python. Returns the starting parts, labelled (here "Base" and "Coin"), or None to start empty.
    ...

def build():
    m = mt.Model(base(), params=PARAMS)
    # mantel:steps begin
    m.body("Block", shape="box", size=(mt.P("BLOCK_W"), 30, 60))
    m.plane("Mid plane", midplane=(m.face("Block", "left"), m.face("Block", "right")))
    m.hole("Mount hole", on=m.face("Base", "bottom"), at=(10, 10), diameter=mt.P("HOLE_D"), depth="through")
    m.text("Deal text", on=m.face("Base", "front"), text="ACME × GLOBEX", mode="engrave", depth=0.5)
    m.combine("Coin cavity", target="Block", tool="Coin", operation="cut", keep_tool=True)
    # mantel:steps end
    return m.result()
```

- **Restricted grammar inside the markers.** Each step is one statement `m.<action>("<name>", key=value, ...)`. A value is a literal (number, string, boolean, tuple or list of literals), a parameter reference `mt.P("NAME")`, or a reference `m.face(...)`, `m.edge(...)`, `m.datum("<plane name>")`, `m.point(...)`, `m.part("<label>")`, or the bare name of a top-level function in the script (used only by `custom`, below). References use different names from actions, so `m.plane(...)` always means "add a plane". Suppressed steps are kept as the same call with `suppressed=True`. Custom steps are `m.custom("<name>", action="finger-notch@2", ...)` for a saved action, or `m.custom("<name>", fn=finger_notch, ...)` for an unsaved one defined in the same script.
- **The Worker edits the section, not the engine.** A small parser in the Worker, in the spirit of `src/server/params.ts`, locates the markers and the statements between them and inserts, replaces, reorders or removes one statement. Bytes outside the markers never change. If the section contains anything outside the grammar, the edit is refused with "ask the agent to tidy the steps section", exactly as `setParameter` refuses computed values. _(my call: editing in the Worker avoids a container start per edit.)_
- **Names are unique** within a model and become the step's identity. Renaming a step rewrites references to it in the section.
- **No markers, no timeline.** A free-form script without markers works as today. The first action on such a model is refused with a message asking the agent to adopt the standard shape. The modeling skill teaches it.

### References that survive rebuilds

Face numbers from a build (the inspect record's face index) change when the model changes, so steps never store them. When the person clicks a face, the browser turns it into the most stable reference available, in this order:

1. **A created name**, if a step made that face: `m.face("Mount hole", "wall")`.
2. **A part's named side**, if the face is the part's extreme planar face along an axis: `m.face("Base", "bottom")`. Every part has `top`, `bottom`, `left`, `right`, `front`, `back`.
3. **A geometric query**: `m.face("Block", normal=(0, 0, 1), near=(12.0, 4.5, 60.0))`. It resolves to the face on that part with a matching normal (within 1°) whose centroid is nearest the point, and fails if two candidates are within a tie tolerance. _(my call: the tolerances are the builder's to tune with tests.)_

Edges use the same order, for example `m.edge("Block", between=("top", "front"))` or "all edges of" a face. A reference that does not resolve makes its step fail with `face_not_found` or `ambiguous_reference`. It never falls back to a different face.

This requires the inspect record (PR #28) to add, per face, the names that resolve to it, so the browser can choose option 1 or 2.

### Step states

The engine runs steps in order and records each one in the build facts as `steps: [{name, action, version, state, code?, message?, created: [...], ms}]`:

| State        | Meaning                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `ok`         | Ran and produced valid geometry.                                                                   |
| `warning`    | Ran, but something needs attention, such as a fillet radius clamped or text running past the face. |
| `failed`     | Did not run. The model continues without it. Carries a failure code from the action record.        |
| `blocked`    | Not run because it refers to something a failed or suppressed step would have created.             |
| `suppressed` | Turned off by the person or agent.                                                                 |
| `pending`    | Saved but not yet built. Shown in the viewer only.                                                 |

**A build with any failed or blocked step still produces artifacts**, so the person can see and fix it, but the build is marked `incomplete` in its facts. The viewer shows a red timeline badge. `inspect` checks on an incomplete build report `unknown`, never pass. _(my call: matches how Fusion keeps going past a broken feature, without letting a partial model pass checks.)_ An error outside the steps, in `base()` or in the script itself, still fails the build as today.

### View as of a step

The timeline has a rollback marker. Choosing "view as of step N" queues a build of the same revision that stops after step N and exports only the preview GLB. It is cached per revision and step, writes no revision and counts toward the build cap. The agent gets the same through `builds_view_as_of`. _(my call: on demand rather than after every step, because exporting every step multiplies build time and storage.)_

### Default actions

**Batch 1** (deal-toy first):

| Action    | Does                                       | Key inputs                                                                                                                                                      |
| --------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body`    | Adds a new labelled part from a primitive. | box, rounded box, cylinder, cone, sphere; size; placement on a plane or point                                                                                   |
| `plane`   | Adds a construction plane.                 | offset from a face or plane; angle about an edge; midplane between two faces; through three points                                                              |
| `extrude` | Extrudes a profile from a face or plane.   | profile shape and size; distance, symmetric, or up to a face; taper angle; operation new, join or cut                                                           |
| `hole`    | Cuts a hole.                               | simple, counterbore, countersink; diameter and depths; position by point, by offsets from two edges, or centred; depth by distance, through all or up to a face |
| `fillet`  | Rounds edges.                              | edges; radius                                                                                                                                                   |
| `chamfer` | Bevels edges.                              | edges; distance, or distance and angle                                                                                                                          |
| `text`    | Engraves or embosses text on a face.       | text; font from the installed set; height; depth; alignment and offset on the face                                                                              |
| `combine` | Joins, cuts or intersects parts.           | target; tool; operation; keep tool. Cut with keep tool makes an embed cavity                                                                                    |
| `move`    | Moves or aligns a part.                    | translate; rotate about an axis; align a face to a face with an offset                                                                                          |
| `custom`  | Runs a saved custom action.                | the custom action's own inputs                                                                                                                                  |

**Batch 2:** `shell`, `pattern` (linear and circular), `mirror`, `split` (by plane or face), `offset_face` (Press Pull on any face).

Each built-in action's catalog entry, implementation and tests ship together.

### Custom actions

The agent, or a person through the agent, writes a custom action as a decorated Python function:

```python
@mt.action(
    id="finger-notch",
    summary="Cut a rounded finger notch into an edge so a lid can be lifted.",
    inputs={"on": mt.Face("Face the notch opens onto"),
            "width": mt.Length("Notch width", min=8, max=40),
            "depth": mt.Length("How far the notch cuts in", min=1, max=10)},
    creates={"notch": "The curved notch face"},
    example='m.custom("Lid notch", action="finger-notch@1", on=m.face("Lid", "front"), width=18, depth=3)',
)
def finger_notch(m, on, width, depth): ...
```

- **Saving** (`actions_save`) stores the source and the record, then builds the example against the model revision it was written in. The action joins the store only if that build succeeds and every name in `creates` exists afterwards. The record keeps the revision it was validated on. A successful example proves it ran once, not that it suits every model, so the description should say what it assumes.
- **Scope.** A maker's saved action is project-scoped. Making it available to the whole team needs `settings.manage`, the permission that already guards `skills_save`. _(my call: a bad shared description misleads every session, so sharing gets an approval.)_
- **Pinned versions.** A script refers to `finger-notch@2`. At build time the Worker sends the script together with the pinned sources of the custom actions it uses, so a revision always rebuilds identically. The engine places them in a read-only module directory. This extends today's single-file build input.
- **Same isolation.** Custom actions are Python that runs only in the build container, under the same limits as the model script. They are not Worker tools, so the existing rule "adding executable tools requires a reviewed deployment" is unchanged.

Before saving, the decorated function lives in the script outside the markers and is called with `fn=`. Saving lifts it into the store and rewrites the call to `action="finger-notch@1"`. The agent is told to offer to save a function when it writes the same thing twice.

### What the agent always sees

- **Catalog index.** `session_start` returns a compact index: one line per action, `id@version: summary`, plus presets. When the catalog changes during a session, the next tool result includes the changed lines.
- **Model summary.** Every tool result for a call that names a model ends with a compact summary of that model, at most about 1,500 characters _(my call)_: steps with their state and any failure message; parts; named faces and planes; parameters with values; the person's current selection as references.

  ```
  Model "Tombstone" r14, build incomplete.
  Steps: 1 body "Block" ok · 2 hole "Mount hole" failed face_not_found (Base.bottom) · 3 text "Deal text" ok
  Parts: Block, Base, Coin. Planes: Mid plane. Params: BLOCK_W=80 mm, HOLE_D=5 mm.
  Selected: face("Block","top")
  ```

- **Full detail on request.** `actions_describe(id)` returns the full record, and `actions_list(filter?)` searches it.

### Agent tools

New MCP tools in `src/server/tools.ts`, permissions in `src/server/access.ts`. Reads need read access, so demo projects can be studied. Writes need owner access, the same as `models_save`, plus `settings.manage` for team-scoped actions and presets.

- `actions_list(filter?)`, `actions_describe(id)`: the store.
- `steps_add(modelId, expectedRevision, action, name, inputs, after?)`: validates the inputs against the action's schema and inserts the call. Returns the new revision.
- `steps_edit(modelId, expectedRevision, name, inputs)`, `steps_remove`, `steps_move(name, after)`, `steps_suppress(name, suppressed)`, `steps_rename(name, newName)`.
- `actions_save(record, source, expectedVersion)`, `presets_save(action, name, description, inputs, expectedVersion)`.
- `builds_view_as_of(revisionId, step)`.

_(my call: generic `steps_*` tools that take an action id, rather than one MCP tool per action. That gives built-in and custom actions one path, keeps the tool list short, and avoids clients holding a stale tool list after a custom action is saved. The catalog index and `actions_describe` carry the descriptions. Alternative: expose each built-in action as its own MCP tool for client-side schema validation. Revisit if agents misuse inputs.)_

Every step change is recorded in the activity log as an agent or person event, like parameter edits.

### Interface

- **Toolbar** generated from the store, grouped by category, with saved custom actions under Custom. Hovering shows the summary. A "?" opens the description.
- **Form panel** generated from the input schema. Pick fields show the current reference and a "pick" button; clicking the model fills them. Variant inputs show only the fields for the chosen variant. A preset menu fills the form, and "Save as preset" stores the current values.
- **Ghost preview** while the form is open, drawn from the action's `preview` primitive and the picked references, labelled "preview". Commit saves the revision. The real build replaces the ghost when it arrives.
- **Timeline** strip under the viewer: one chip per step, with state colour, a drag handle to reorder, a suppress toggle and the rollback marker. Clicking a chip highlights what the step created and opens its form for editing. Failed and blocked chips show the failure explanation and fix from the store.
- **Live.** Steps added by the agent appear in the person's timeline through the existing live relay, attributed to the agent, and the reverse.
- **Mobile.** Timeline, step forms and presets work at phone width. Face picking may be desktop-first. _(my call)_

## Prior art

- **Fusion** (inspected from the locally installed app, 2026-11-05): every command definition ships a tooltip, how-to text, a hotkey and an edit id. Every feature type has a typed input object with variants. Timeline entries carry a health state and message and can be suppressed, reordered and rolled back to. Mantel's action record and step states follow the same pattern. No Autodesk text is reused.
- **The owner's fusion-recreation engine** (`code/fusion-recreation`): typed operations, named references, shared selection, preview then commit, and MCP explain, inventory and context tools. It validates the same ideas for an agent; its patterns can be borrowed where they fit Mantel's script model.
- **MCP itself**: name, description and input schema per tool. The action record is a superset of that shape.

## Validation

- **Catalog parity:** every catalog entry has an engine implementation, a valid JSON Schema with a description on every property, at least one failure code, and an example that builds.
- **Script editing:** for each step operation, a round-trip test shows bytes outside the markers are unchanged. Scripts with out-of-grammar content are refused. Conflicting revisions are refused.
- **Engine per action:** each action builds its example, reports `ok`, and creates its declared names. Each failure code is triggered by a test.
- **Reference stability**, on the deal-toy fixture (acrylic block with a coin cavity, engraved base, two mounting holes, filleted edges): change `BLOCK_W` and `HOLE_D` across their ranges and confirm every step still lands on the intended face, measured with the inspect record. A deliberately ambiguous query fails with `ambiguous_reference`.
- **Incomplete builds:** a failed step yields artifacts, `incomplete` facts, blocked dependants and `unknown` checks.
- **Custom actions:** saving one with a failing example is refused. A pinned version rebuilds identically after a newer version is saved.
- **Agent context:** the model summary stays under its size limit for the fixture with 30 steps.
- **End to end:** a person adds a hole by picking a face and filling the form, sees the ghost, commits, and the agent's next tool result shows the new step. The agent adds a text step and it appears in the person's timeline.

## Left to the builder

- The catalog file format, and how the Worker and engine images share it.
- The Worker-side step-section parser, within the grammar above.
- Reference resolution tolerances, and the exact rules for part named sides on non-box parts.
- Ghost-preview rendering details.
- How custom-action sources are passed to the engine and where they live in the container.
- Size limits on custom-action source, presets and the number of steps.

## Open questions

- Should a step's numeric inputs accept expressions of parameters (`mt.P("BLOCK_W") / 2`)? That makes steps more useful but weakens the grammar's editability. _(Default: no, in batch 1.)_
- Should reordering a step that others depend on be refused, or allowed and shown as blocked? _(Default: allowed, shown as blocked.)_
- Does the team want a review screen for shared custom actions, or is the `settings.manage` permission enough?
- Order relative to the inspect work: face picking (inspect batch 1) is needed before pick-to-fill forms. _(Default: build inspect batch 1 first, then actions batch 1.)_
