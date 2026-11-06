# Inspect, measure and fit

Status: proposed design, 2026-11-05. Builds on the current foundation (`docs/architecture.md`) and the live workspace (`2026-10-28-agent-live-workspace-design.md`).

## Intent

Today a build reports a bounding box, a summed volume, a solid count, labelled parts and declared `PARAMS`. That is enough to confirm a model exists, but not to check whether it meets its requirements. An engineer checks a design by poking at it: clicking a part or a face and reading its dimensions, seeing the gap between two parts, slicing through the assembly, and pulling the pieces apart to see how they fit. Fusion calls these Inspect tools; SolidWorks calls them Evaluate tools.

This change gives Mantel the same ability, with one difference that matters for an AI-native workspace: **everything a person can inspect, check or adjust, the agent can do through the same tools, and each sees what the other did.**

**The first users are deal-toy makers**, the people at a deal-toy studio designing and checking pieces such as acrylic embedments, cast or machined metal figures on bases, and engraved plaques. So the first checks are the ones that decide whether a deal toy works. Does it stand up without tipping? Is the embedded object clear of the block's surfaces, with enough acrylic around it? Is the engraving deep enough? Do the pieces fit together? General mechanical checks such as mould draft come second. _(Decided by the product owner, 2026-11-05.)_

The motivating evidence is a published test of an AI CAD copilot building an injection-moulded enclosure from a detailed brief (Engineering Gone Wild, "I Let GPT-6 Astra Do ALL My CAD Work", 2026-10-25). The model matched every number the reviewer checked, but it had ribs running into the screw bosses, no draft, and a 1.8 mm undercut on the cover lip. A reviewer found each problem with one specific measurement against one specific requirement. Mantel should make those measurements cheap, visible and repeatable on every revision.

## Decisions already made

These were decided by the product owner in conversation on 2026-11-05:

- **Click to inspect.** Clicking a part or a face shows what was measured about it. Clicking two faces or two parts shows the distance and clearance between them.
- **See how parts fit.** The person can cut through the model and pull the parts apart and back together to see how they fit.
- **Four ways to adjust, all in scope:**
  - **A.** Type a new value on a measurement. Mantel finds the parameter that drives it, saves a new revision and rebuilds.
  - **B.** Drag a face on the model, like Fusion's Press Pull. A live number follows the drag; releasing saves a new revision.
  - **C.** Move and fit parts: drag a part along the way it attaches, explode and collapse the assembly, and set how far a part sits.
  - **D.** Change what is measured and the pass/fail limits: add a check, change a limit, turn a check on or off.
- **Agent parity.** The agent can inspect, measure, add and edit checks, and make the same adjustments. Changes by either side appear live to the other.
- **Primary users are deal-toy makers.** Deal-toy checks ship first: stability, embed clearance and wall, engraving depth, fit and overlap. Draft is supported but not a first-batch priority.
- **First batch:** face picking with exact measurements, section cuts, and editable checks, together with adjustments A, B and D. **Second batch:** declared joints, explode and collapse, and adjustment C. The second batch changes how models are written, not just how they are viewed.

The following were proposed by Claude and accepted as part of the playback ("looks good, add to requirements"). They remain open to revision:

- **Dimensions are declared by the script.** A model script says which measurement a parameter controls, for example "wall thickness is the distance between these two faces, driven by `WALL_T`". Faces with a declared dimension can be edited by typing (A) or dragging (B). Every other face still shows exact measurements, read-only, with an "ask the agent to make this…" action.
- **Every adjustment creates a new revision** through the existing conflict check, as parameter edits already do.
- **Checks are a list saved with the project.** Person and agent edit the same list, and each check records who created it and who last changed its limit.

## Goals

1. Clicking a face shows its type (plane, cylinder, cone, other), area, and the measurements relevant to its type: normal for planes; diameter, axis and depth for holes and bosses; radius for fillets. It also shows the thickness to the opposite face where one exists, and any declared dimension that includes it.
2. Selecting two faces or two parts shows the minimum distance between them, and whether they overlap and by how much volume.
3. A section plane can be dragged through the model along X, Y or Z or aligned to a picked face. Cut faces are filled so walls and gaps read clearly.
4. A check list shows pass, fail or unknown for every check on the selected revision. Failures and near-misses are coloured on the model: overlap red, a clearance under its limit amber, a face under its draft limit amber.
5. Editing a declared dimension, by typing or by dragging, saves one new revision and rebuilds. The UI shows a preview during the drag and replaces it with the rebuilt geometry.
6. Changing a check's limit updates the result immediately, without a rebuild, when the measurement already exists.
7. The agent can do everything in 1 to 6 through MCP tools, and can highlight faces or parts in a watching person's viewer.
8. Results attach to an exact build. Older revisions keep their own results, and a check can say "this was 0.30 mm in revision 6 and is 0.10 mm in revision 7".
9. All of this works on the demo project read-only: viewers can inspect, measure and cut, but not save checks, adjust or queue measure jobs.
10. The model reports whether it stands up: its centre of mass, its footprint on the table, and how far it can tilt before it tips. It also reports how close each embedded object comes to the outside of its block.
11. Values display in millimetres. An inch display toggle is a later addition; stored values stay in millimetres. _(My call.)_

## Non-goals

- Drawings, GD&T and release approval (see `docs/manufacturing.md` and `docs/roadmap.md`).
- Strength, thermal or motion simulation.
- A full minimum-wall-thickness map of arbitrary curved geometry. Version 1 measures thickness between opposing faces and between declared or picked pairs.
- Undercut detection. Version 1 reports "undercut: not checked" rather than implying a pass. It is the first follow-up after this design.
- Supplier process libraries. Checks are generic. Process presets (for example "injection moulding: draft ≥ 1°, no part overlap") are templates that add ordinary checks, not hidden rules.
- Editing faces with no declared dimension by direct geometry manipulation. That would turn the script into a mesh editor. Those faces go through the agent.

## Anti-goals

The feature fails, even if it works technically, if any of these happen:

- A number on screen comes from the browser mesh rather than the exact geometry. The GLB is tessellated at 0.05 mm; inspection values must come from OCCT.
- A check shows "pass" when it could not be evaluated, for example because the face it referred to no longer exists. That is "unknown", visibly.
- A drag or a typed value changes anything other than the one parameter it is bound to, or overwrites newer work.
- The agent's adjustments or check edits are indistinguishable from the person's.
- A passing check list is presented as manufacturing approval. Build facts keep `manufacturing_approval: "not_reviewed"`.

## How it works

### Measured once, in the engine

All exact measurements come from the build container, which already holds the exact OCCT shape. There is no persistent geometry process: each build is one disposable container, and that boundary stays. So the build computes an **inspection record** alongside today's facts, and the browser and agent read that record:

- **Per part:** label, bounding box, volume, surface area, centre of mass, and mass when a density is declared.
- **Per face:** a stable index within the build, owning part, surface type, area, centroid, and type-specific data: plane origin and normal; cylinder or cone axis, radius and extent; torus and sphere radii. Faces on the same axis with the same radius are grouped into holes or bosses with diameter, depth and through or blind.
- **Part pairs:** the minimum distance between each pair of labelled parts, and their overlap volume.
- **Declared dimensions:** see below, each with its measured value.
- **Draft:** for each part with a declared pull direction, the angle of each face to that direction.
- **Stability:** the whole model's centre of mass and the footprint it rests on. The footprint is the convex hull of the downward-facing faces at the lowest Z, which assumes the model stands upright on a flat table in its modelled orientation. The record includes the smallest tilt angle that carries the centre of mass outside the footprint, and the direction of that tilt.
- **Embeds:** for each declared embed (a part intended to sit inside another, such as an object cast into acrylic), whether it is fully contained and the minimum distance from it to the host's outer surface.

The engine produces measurements only. **Checks are always evaluated in the Worker**, as a pure function of an inspection record and the current check list. One evaluator means a result can never differ depending on whether it was computed at build time or after a limit edit, and builds need no check-list input. _(Builder-check answer, my call.)_

Many distances the person picks later can be computed exactly in the browser from this data, without the engine: plane to parallel plane, axis to axis, point to plane. A pick that needs the kernel, for example the minimum distance between two curved faces, queues a **measure job** on the existing build (see "Measure jobs").

The browser needs to map a clicked triangle to an engine face. The build must emit that mapping alongside the GLB, for example per-face mesh primitives or a triangle-to-face index sidecar. The builder chooses the format and must keep the GLB within its current size limit.

### Declared dimensions

A script may define an optional top-level function `dimensions(shape)`, called after `build()`. It returns a list of declarations that reference real build123d faces or edges of the returned shape:

```python
def dimensions(shape):
    housing = shape.children[0]
    outer = housing.faces().sort_by(bd.Axis.X)[-1]
    inner = ...  # the matching inner wall face
    return [
        {"name": "Wall thickness", "param": "WALL_T", "between": (inner, outer), "moves": outer},
    ]
```

The runner resolves each referenced face to its face index by topological identity. It measures the value and checks that it equals the parameter's value within a small tolerance. If it does not, the declaration is shown as measured but not editable, with the mismatch, so a wrong declaration cannot make a drag change the wrong amount. `moves` names the face that a drag moves. `scale` (default 1) covers cases such as a diameter driven by a radius parameter. Declarations that fail to resolve are reported as warnings, not build failures.

The modelling skill (`skills/modeling/SKILL.md`) gains a step: declare a dimension for every `PARAMS` entry that is a distance, thickness, diameter or offset.

### Pull direction

A part may declare a pull direction for draft measurement, for example `PULL = {"Housing": (0, 0, 1)}` at top level, or a field in `dimensions` output. The builder chooses which. Without it, no draft is measured and draft checks report "unknown: no pull direction".

### Materials and embeds

Stability depends on mass, not volume. A brass figure inside an acrylic block moves the centre of mass a long way, because brass is about seven times denser than acrylic. A script may therefore declare a density per part, for example `MATERIALS = {"Block": {"name": "cast acrylic", "density_g_cm3": 1.19}}`. When any part lacks a density, the stability result is computed with uniform density, labelled "assumes uniform density", and stability checks report unknown rather than pass. _(My call: a deal-toy tipping result based on the wrong mass would be misleading.)_ Densities are the script author's statement, not a supplier's data.

A script may declare embeds, for example `EMBEDS = [{"part": "Coin", "in": "Block"}]`. A declared embed is excluded from overlap checks against its host, since the overlap is intended. Its containment and wall distance are measured instead. Undeclared overlaps are still overlaps.

### Checks

A check is a saved rule: what to measure, the limit, enabled or not, who created it and when, and who last edited it. Checks belong to a model within a project (new D1 table). Version 1 check kinds:

| Kind       | Refers to                                               | Passes when                                                               |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Stability  | the whole model                                         | tip angle ≥ limit, with every part's density declared                     |
| Embed wall | a declared embed                                        | fully contained, and minimum distance to the host's outer surface ≥ limit |
| Dimension  | a declared dimension name (for example engraving depth) | value within nominal ± tolerance                                          |
| Clearance  | two parts, or two picked faces                          | minimum distance ≥ limit                                                  |
| No overlap | two parts, or all labelled parts except declared embeds | overlap volume ≤ 0.001 mm³                                                |
| Envelope   | the whole model or a part                               | bounding box within limits                                                |
| Hole       | a picked hole                                           | diameter within limits                                                    |
| Draft      | a part with a pull direction                            | every non-perpendicular face ≥ limit, with listed exceptions              |

The first five are the deal-toy priority, in that order. Process presets (for example "acrylic embedment" adding Stability, Embed wall and No overlap) only add these ordinary checks. A preset's default limits are marked "TBD: confirm with your maker" until a person enters them. Mantel must not invent supplier minimums.

Checks must survive new revisions. They refer to stable names wherever possible: declared dimension names and part labels. A check on picked faces stores a geometric signature (surface type, normal or axis, centroid, area, owning part label). For each build, the Worker finds the matching face in that build's record. If none matches confidently, the check is **unknown: re-pick needed**, never pass. If two parts share a label, checks naming that label are unknown, and the build reports the duplicate as a warning. _(My call.)_

Changing a limit or the enabled state re-evaluates against the existing record, with no rebuild. A check whose measurement cannot be computed from the record (for example the clearance between two curved picked faces) queues a measure job once per build. Until it returns, the check is unknown.

### Measure jobs

A measure job runs in a fresh container like a build, but does not execute the model's Python. It loads the build's persisted STEP, computes the requested measurement and returns it. Face indices must therefore be defined on the STEP-reloaded shape in the build job as well, so indices agree between build and measure jobs. The builder must verify this in tests, or choose an equivalent stable scheme. Measure jobs use the same isolation, limits and artifact rules as builds. They write no new revision. _(My call: they count toward the daily build cap, to keep the abuse limits simple. Revisit if it bites.)_ Only members with owner access to the project can queue them. Demo viewers get every measurement computable from the record, and a note when a pick needs the engine. This keeps the existing promise that signing up alone costs no compute. _(Builder-check answer, my call.)_

### Viewer

- **Pick:** click selects a face. Shift-click adds a second face or part. A breadcrumb switches between face, part and assembly. The side panel shows measured values, any declared dimension, and the checks that involve the selection.
- **Section:** a plane gizmo with axis buttons and "align to face", with filled cut faces. Section is visual only in version 1.
- **Colour:** overlays for overlap, clearance under limit and draft under limit, each switchable.
- **Adjust by typing (A):** declared dimension values are editable inline. Saving calls the existing parameter edit, so range limits, conflict refusal and revision history are unchanged.
- **Adjust by dragging (B):** faces with an editable declared dimension show a handle. Dragging shows a ghost outline of the `moves` face at its new position along its normal, without deforming the mesh, which would tear it from neighbouring faces. It also shows the live value, snapped to 0.1 mm and clamped to the parameter's range. _(Builder-check answer, my call.)_ Releasing commits through the same edit. The preview is labelled as a preview until the rebuild arrives.
- **Ask the agent:** with any selection, "Ask the agent to…" writes a team note containing the request and the selection's stable references. The existing note delivery hands it to the running session.
- **Mobile:** inspection, section and check list work at phone width. Dragging handles may be desktop-only (my call).

### Agent tools

New MCP tools in `src/server/tools.ts`, with permissions declared in `src/server/access.ts`. Reads use read access, so they work on demo projects. Writes need owner access.

- `inspect_get(buildId, filter?)`: the inspection record, or the part of it for given parts, faces or checks.
- `inspect_measure(buildId, refs)`: queue or compute a measurement between references. Polled like `builds_get` when queued.
- `checks_list(modelId)` and `checks_save(modelId, checks, expectedVersion)`: read and replace the check list with conflict protection, matching how sources and skills are versioned.
- `view_highlight(sessionId, refs, message?)`: highlight faces or parts in watching viewers through the live relay. It is recorded as an agent event. It changes nothing in the model.
- Adjustments use existing `models_set_parameter`. Joints and placement (batch 2) add parameters, not a new edit path.

`skills/modeling/SKILL.md` gains steps: declare dimensions, densities, embeds and (when relevant) pull directions, then after building read `inspect_get` and report failed and unknown checks. A new skill, `inspecting`, covers how to set up checks from a brief.

### Batch 2: joints and fit

Scripts declare how parts attach using build123d joints (rigid, revolute, linear). The runner exports each joint's frame and degree of freedom in the inspection record. The viewer gets an explode slider that moves parts apart along their joints, and dragging a part along its joint. Setting where a part sits is a declared dimension on a placement parameter, so it uses the same edit path as A and B. "Can the lid slide on without hitting anything" is a later sweep check, out of scope here.

## Validation

- **Deal-toy fixture (primary):** add a synthetic, editable deal toy to `examples/`. A brass-density coin sits in an acrylic block on an engraved base, with deliberate faults: the coin is off-centre and too close to one face of the block, the block is tall enough to tip at a known angle, and one engraving is shallower than its declared depth. Engine and Worker tests assert the analytic tip angle, embed wall distance and engraving depth, and that the checks fail. Removing one density turns the stability check unknown.
- **Enclosure fixture:** add the video's enclosure as a second example with its deliberate faults: ribs overlapping the bosses, no draft, a 0.3 mm lip clearance. Tests assert the overlap volume, clearance 0.30 mm and draft 0°.
- **Exactness:** compare record values with analytic values on simple solids (block, tube, filleted box) to 1e-6 mm.
- **Stability:** a check on a picked face survives a parameter change that moves but does not remove the face, and becomes unknown when the face is deleted.
- **Index agreement:** build and measure jobs give the same face indices for the same build.
- **Authorization:** demo viewers can read and measure from the record, but cannot save checks, adjust, highlight or queue measure jobs. Every denial path is tested, as `AGENTS.md` requires.
- **UI:** desktop and phone widths, both themes; drag preview, commit and conflict paths.
- **Performance:** record size and build-time overhead measured on the existing demo models and recorded in `docs/validation.md`. Above a face cap (proposed 20,000 faces, my call), only per-part data is recorded and the UI says so.

## Left to the builder

- Mesh-to-face mapping format, inspection record schema and its storage: a new allowlisted artifact such as `inspect.json`, or an extension of `facts.json`.
- How `dimensions()` and pull directions are spelled, within the constraints above.
- Signature matching tolerances for re-finding picked faces.
- Section-cap rendering technique and gizmo design, within the existing light and dark themes.
- How measure jobs share code and queue paths with builds.

## Open questions

None blocking. The defaults marked "my call" above can be revised by the product owner. The first follow-ups after this design are undercut detection, inch display, and the batch 2 sweep check, "can this part slide into place".
