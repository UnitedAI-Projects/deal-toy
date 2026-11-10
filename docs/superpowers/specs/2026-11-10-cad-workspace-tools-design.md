# CAD workspace tools: origin planes, the tool bar and sketching

Status: proposed design, 2026-11-10. Builds on the modeling actions (`2026-11-05-modeling-actions-design.md`), the enforced structure (`2026-11-09-sequential-editing-and-agent-presence-design.md`) and the inspect work. The blueprint view and its drafting tools, and the new-workflow demo, are separate designs that follow this one.

## Intent

Mantel should feel like the CAD tools people already know. The product owner pointed at [SolidCraft](https://github.com/tangency-labs/solidcraft) (MIT OR Apache-2.0) as the industry-standard feature set: you pick a plane, sketch on it with lines and arcs you dimension, then turn the sketch into a solid with extrude, revolve and the other features, all from a tool bar of standard commands. Today Mantel has 15 actions behind one "+ Add step" button, no visible origin planes, and no sketching: profiles come from a fixed list of shapes.

The point of Mantel is that a person and an agent build the same model with the same tools. So every command in the new tool bar is a self-describing action in the existing catalog, the same record the agent reads. SolidCraft is the reference for which commands exist, what they are called and how they behave. None of its code is copied.

## Decisions already made

Decided by the product owner in conversation on 2026-11-10:

- **Origin planes.** "I should be able to see planes. xyz."
- **Self-describing commands.** Every command is in a store an agent can read, described like an MCP tool. The existing catalog is that store; it must grow to cover the standard commands.
- **Standard tools.** The tool bar offers the commands standard across CAD software, with SolidCraft's feature list as the reference.
- **Real sketching.** "I need real sketching drawing and dimensioning lines and arcs on a plane." This reverses the 2026-11-05 non-goal of no sketch editor.
- **Layout B.** Mantel's floating style, chosen from two mockups: the model fills the screen, the tools sit in one compact floating bar whose groups open dropdowns, the Browser is a card that collapses, and the timeline floats at the bottom.
- **New workflow only.** The free-form agent-written models (SpaceX, DigitalBridge) are being deleted. Tools need to work on models built from steps, not on free Python. A new demo will be built with the new workflow afterwards.
- **3D tools before the blueprint view.**

## Goals

1. **Origin you can see and use.** XY, XZ and YZ planes and the X, Y and Z axes are drawn at the origin and can be picked like any construction plane or edge.
2. **A tool bar generated from the catalog.** Groups and buttons come from action records; nothing in the tool bar exists that the agent cannot also call, and no button appears for an action that is not implemented.
3. **Sketches.** A person can start a sketch on an origin plane, a construction plane or a flat face, draw and constrain lines, arcs, circles and the other standard sketch entities, dimension them, and finish. An agent can create and edit the same sketch through the same action.
4. **Sketch-driven features.** Extrude and revolve take a sketch's closed profiles as well as the existing fixed shapes.
5. **More of the standard solid set.** Rectangular and circular pattern, and mirror, join the catalog in this design. Later batches follow the same pattern.
6. **Works from an empty model.** Choosing a tool on a new, empty model starts the standard steps layout; nobody has to write Python first.

## Non-goals

- The blueprint view and drafting tools (next design).
- The new demo project (after both designs).
- Surfaces, sheet metal, plastic parts, assemblies and motion studies: SolidCraft has them; deal toys do not need them yet.
- Editing free-form Python models with the tool bar. Free Python stays possible through the custom step.
- Sketch editing on phones. Phones show sketches and the tool bar read-only. _(my call)_
- A 3D sketch, splines in v1 beyond a fit-point spline, equation curves, and projecting edges onto a sketch. _(my call; candidates for a later batch)_

## Anti-goals

Carried over from 2026-11-05 and still binding:

- **A reference that drifts.** A sketch profile, a face or an edge that silently resolves to something else after a rebuild.
- **A description that lies.** A tool whose record does not match its behaviour, or a button for something that does not work.
- **Edits outside the step section.**
- **An action list the agent can't choose from.** Sketching must not add a hundred near-duplicate agent tools.
- **Silent partial models.**

New for sketching:

- **A sketch that looks constrained but is not.** The sketch must always say whether it is fully constrained, under-constrained (and by how much), or over-constrained (and which constraints conflict).

## How it works

### The screen (layout B)

- **Top left:** the Mantel and project chips, as today.
- **Top right:** command search, Checks, the agent status and the ⋯ menu, as today.
- **Floating tool bar, top centre,** replacing "+ Add step". Groups in this order: **Sketch, Create, Modify, Arrange, Construct**, then **Custom**. Each group shows its most-used tools as buttons and opens the rest from its ▾. The buttons shown are chosen by a `featured` flag on the action record. _(my call)_ While sketching, the bar switches to the sketch tools: **Create, Modify, Constraints, Dimension, Finish sketch**.
- **Command search** finds any action by title, id or summary and opens its form. _(my call: in the top-right search chip)_
- **Browser card, left,** collapsible: **Origin** (XY, XZ, YZ, X, Y, Z, each with a show/hide eye), **Bodies**, **Sketches**, **Construction**. Clicking an item selects it on the model.
- **Triad, top right of the view,** showing X red, Y green, Z blue, matching the axes.
- **Bottom:** the activity feed stays bottom left; the section and explode tools stay bottom right; the step timeline floats bottom centre beside the revision chips.

### Origin planes and axes

- Planes are translucent squares sized to the model's bounding box (with a minimum), coloured by their normal axis: XY blue, XZ green, YZ red, following the usual convention that a plane takes the colour of its normal. _(my call; the mockup used other colours)_
- Shown by default on an empty model and while sketching; hidden by default otherwise; the Browser eye overrides. _(my call)_
- Picking a plane fills a `plane` input with `m.plane("XY")` (and `"XZ"`, `"YZ"`); picking an axis fills an `axis` input with `m.axis("X")`. These are new built-in references in the engine, so they never drift.

### The tool bar is the catalog

Every button is an action record in `engine/lib/mantel/catalog.json` or a saved action. A record gains two optional fields:

| Field      | Purpose                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `group`    | Tool bar group when it differs from `category` (for example sketch tools). |
| `featured` | Shown as a button in its group rather than only in the ▾ list.             |

The agent's always-on action index is unchanged in form. Adding sketching adds one action (`sketch`) to that index, not one per entity, so the agent's list stays short.

### Sketches

A sketch is one step: `m.sketch("Base outline", on=m.plane("XY"), ...)`. Its inputs, all described in its record:

- **`on`**: an origin plane, a construction plane or a flat face. Entity coordinates are 2D, in the sketch plane's own axes. Origin planes use the standard axes: XY is X right and Y up; XZ is X right and Z up; YZ is Y right and Z up. A face's sketch plane has its origin at the face's centre, and its X axis is the global X projected onto the face, or the global Y when X is normal to it. That makes the axes repeatable across rebuilds. _(my call)_
- **`entities`**: an ordered list. Each has an `id` and a `type`: `point`, `line`, `arc`, `circle`, `ellipse`, `rectangle`, `polygon`, `slot`, `spline` (fit points), `text`, and a `construction` flag for reference geometry that makes no profile. Rectangles, polygons and slots expand into lines, arcs and the constraints that keep them square, regular or rounded.
- **`constraints`**: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, concentric, midpoint, symmetric, collinear and fix, each naming the entities and the point (start, end or centre) it applies to.
- **`dimensions`**: distance, horizontal and vertical distance, length, radius, diameter and angle. A dimension's value is a number or a `PARAMS` reference (`mt.P("BASE_W")`), so existing parameter editing drives sketches.
- **`solved`**: the coordinates the solver produced, written by Mantel, never by hand.

The engine never solves anything. It draws the `solved` geometry with build123d, finds the closed loops and makes a face for each, the sketch's **profiles**. That keeps builds deterministic and the build container unchanged.

**Solving happens where the edit happens.** The person's browser solves as they drag, so a sketch feels immediate. The Worker solves when an agent edits a sketch, or when a parameter that a dimension uses changes, before it saves the revision. Both use the same solver build, so they agree.

**Solver: PlaneGCS**, FreeCAD's 2D constraint solver, through the maintained WebAssembly build [`@salusoft89/planegcs`](https://github.com/Salusoft89/planegcs) (LGPL-2.0-or-later, about 0.9 MB). _(my call)_ It is proven in FreeCAD and runs in both the browser and a Worker. It is loaded as its own, unmodified module, which keeps the LGPL obligations simple; THIRD_PARTY_NOTICES records it. The alternative is SolidCraft's own `solidcraft-sketch` crate (MIT OR Apache-2.0), which is cleaner to license but would add a Rust and WebAssembly toolchain to Mantel and has to be cut out of SolidCraft's workspace. The builder should confirm in a first spike that PlaneGCS loads inside the Worker before relying on it there.

**Health.** Every solve reports one of: fully constrained, under-constrained by N degrees of freedom, or over-constrained with the conflicting constraints named. The step's timeline state and the sketch's Browser entry show it; an over-constrained or unsolvable sketch is a failed step, never a silent one.

**Editing a sketch.** Double-clicking a sketch in the Browser or the timeline opens it: the camera looks straight at its plane, the other geometry dims, the bar switches to sketch tools, and the grid snaps. Drawing tools behave as in SolidCraft: click points, see the rubber-band preview, snap to ends, midpoints, centres and the axes, with horizontal and vertical inference adding constraints as you go. Clicking a dimension edits its value or links it to a parameter. **Finish sketch** saves one revision through the existing conflict check. **Cancel** discards the edits.

**Agents** call the `sketch` action with entities, constraints and dimensions (no `solved`), through `steps_add` and `steps_edit` like any step. Mantel solves, stores `solved`, and returns the health and the profile list. Editing an existing sketch is a `steps_edit` with the changed lists, so one action covers creating and changing sketches.

### Sketch profiles in features

Extrude's `profile` input gains `sketch`, with:

- **`sketch`**: the sketch step's name.
- **`profiles`**: which closed loops, as stored signatures (area, centroid, loop count). The default is every closed loop.

A signature that matches no loop after a rebuild fails the step with "the profile this step used no longer exists; pick it again". It never falls back to another loop. Revolve gains the same sketch input plus an `axis` (an origin axis, a sketch line or an edge).

Picking a profile on the model, inside its loop, fills the input, as picking a face does today.

### New solid actions in this design

| Action    | What it does                                                                                                    | SolidCraft reference                                  |
| --------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `pattern` | Rectangular (two directions, counts and spacing) or circular (axis, count, angle) copies of features or bodies. | `solid.pattern.rectangular`, `solid.pattern.circular` |
| `mirror`  | Mirrors features or bodies across a plane.                                                                      | `solid.mirror`                                        |

**What a pattern or mirror copies.** _(my call)_ Its `of` input names either parts or earlier feature steps. A part is copied as a new body, named `<part> 2`, `<part> 3` and so on. A feature step is copied by the volume it added or removed: each action that changes a body already knows its tool solid (the hole's cylinder, the extrude's prism), and records it on the step. Pattern applies that tool solid again at each location, with the same operation (join or cut) on the same target. Copies of a cut that would miss the target fail the pattern step, naming the copy, rather than being dropped.

Later batches, each one PR with its own records, tests and descriptions, in roughly this order: draft, split body, offset face, scale, thread, rib, coil, pattern on path. None appears in the tool bar until it works.

### Starting from an empty model

Choosing a tool on a model with no revision creates revision 1 in the standard steps layout (an empty `base()`, `PARAMS = {}` and the step markers) and adds the step. The same applies to `steps_add` from an agent. The design guard still applies to agents: they need a design sheet and a change plan first, as today; people's own edits are never blocked.

## Validation the builder should show

- Engine tests: each sketch entity, constraint and dimension produces the expected solved geometry; profiles from known sketches have the analytic areas; an over-constrained sketch fails with the conflict named; a profile signature that disappears fails loudly.
- Worker tests: an agent `sketch` step is solved and stored; a parameter change re-solves a sketch before the revision is saved; browser and Worker solves of the same sketch agree.
- Catalog tests: every record has descriptions for every input, the tool bar shows no unimplemented action, and the agent index stays under the existing length limit.
- In the app at 1440 × 900 and 390 × 844, both themes: origin planes and triad, Browser card, the floating bar and its dropdowns, command search, a sketch drawn, dimensioned to fully constrained and extruded, a parameter changed and the extrude following.

## Left to the builder

- Exact icons, spacing and which actions are `featured`, within layout B.
- The DOF display, snap tolerances and inference rules.
- How sketch editing is split into PRs: origin and tool bar first is the natural first PR; then the sketch engine and `sketch` action; then the browser sketch editor; then pattern and mirror.
