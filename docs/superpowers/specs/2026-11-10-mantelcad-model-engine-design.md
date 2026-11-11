# MantelCAD as the Model engine

Status: approved direction ("MantelCAD as the engine"), 2026-11-10.

## Problem

The Model phase's professional view is MantelCAD, but Mantel's own builds, revisions, checks,
drawings and agent still run build123d Python. A design saved in MantelCAD became a loose
`.sc` phase file: it had no revision, no build, no viewer mesh, no checks and no drawings.
So the two views of the Model phase were two different models.

## Decision

A model revision may hold a **MantelCAD design**: the plain-JSON document MantelCAD's
`document.export` returns and `mantelcad-cli` reads (`{"format": "solidcraft/N", ...}`).
Revisions holding build123d Python remain valid and build as before ("legacy" models).
New models start in MantelCAD.

```
MantelCAD (browser, Model phase)  ──document.export──►  models_save (design JSON)
Mantel's agent (Workers AI)       ──models_edit──────►  container: mantelcad-cli run script --in design
                                                          └─► new design JSON ─► models_save
models_build ─► queue ─► container /build:
    design JSON ─► mantelcad-cli run --in design.json --out model.step
                ─► runner.py --step: import STEP (OCCT) ─► model.stl, model.glb, facts.json, inspect.json
    Python      ─► runner.py (unchanged)
drawings, measurements: from model.step (unchanged)
```

### Why STEP is the hand-off

`mantelcad-cli` exports STEP, STL, OBJ and 3MF but not glTF. Mantel's viewer, part labels,
inspection record (faces, holes), checks, measurements and blueprints are already computed
from an OCCT shape, and drawings and measurements already start from `model.step`. Importing
MantelCAD's STEP into the same pipeline keeps every downstream feature working with one code
path. MantelCAD is the source of truth for geometry; OCCT only reads its STEP.

### Detection

A source is a design when it parses as a JSON object whose `format` is `solidcraft/<n>`. The
Worker (`src/shared/cad-source.ts`) and the container (`engine/service.py`) apply the same test.
Python never parses as such an object, so the two cannot be confused.

## Container

- `engine/bin/mantelcad-cli`: a Linux x86-64 release build of `engines/mantelcad`'s CLI, built
  by `engines/build-cad-cli.sh` inside `rust:<toolchain>-bookworm` so its glibc matches the
  `python:3.12-slim-bookworm` runtime. Not committed (190 MB class binary); CI builds it once per
  `engines/mantelcad` tree and caches it. Builds only use the kernel; no GPU device is opened.
- `/build` with a design: writes `design.json`, runs the CLI (`--quiet`, CPU, file-size and
  address-space limits, 300 s timeout, no network, empty environment), then the runner in `--step`
  mode. Feature failures fail the build with the CLI's message. Up to 1 MB of design JSON.
- `/edit` (new): `{design?, commands}` → runs `mantelcad-cli run script.json [--in design.json]
--save out.json --results --quiet` and returns `{design, results}`; a failing command returns
  400 with the CLI's message (the CLI writes nothing when any step fails).
- facts for a design: as for Python, plus `params` from the design's user parameters
  (`model: false`) whose expression is a plain number with an optional unit, so the parameter
  panel and `models_set_parameter` work. `steps` and view-as-of (`stopAfter`) do not apply.

## Worker

- `models_save` takes Python (≤ 100 KB, as before) or a design (≤ 1 MB).
- `models_set_parameter` on a design rewrites that parameter's `expr` to `<value> <unit>`.
- `models_edit` (new, built-in agent and HTTP): applies up to 60 MantelCAD commands to the
  latest revision (or to an empty design when the model has none), saves the result as a new
  revision and queues its build. Only modelling command families are accepted (sketch, solid,
  construct, parameters, timeline, appearance, material, body, surface, sheet, component, joint,
  occurrence, plastic); file, render, view, UI and settings commands are refused.
- `GET /api/revisions/:id/design`: the design JSON, for opening a revision in MantelCAD. Same
  access as reading the revision's source.
- View-as-of builds of a design are refused (400): MantelCAD's own timeline does that.
- External MCP agents still write Python; a design save over MCP is refused with a pointer to
  MantelCAD or Mantel's agent, because the change-plan guard reasons about Python step layers.

## Web

- Model phase, Mantel view: for a design model (or no model yet) the build123d step toolbar and
  command search are hidden; the viewer, parameters, checks, downloads and drawings remain. The
  empty state offers "Open MantelCAD". The source drawer shows a design read-only.
- MantelCAD view, Model phase: opens the latest design revision; **Save to project** saves a new
  revision (creating the model on first save) and queues its build, instead of a loose file. A
  conflicting newer revision is reported, not overwritten.
- The agent in the Model phase gets `model_get` (revision, parameters, features, last build),
  `models_edit` and `models_set_parameter`.

## CI and deploy

- `checks.yml`: a `cad-cli` job restores or builds the CLI keyed by the `engines/mantelcad` tree
  (`cad-cli-<tree>`), uploads it as an artifact; `test` downloads it before building the image,
  and the container smoke test also builds a MantelCAD design.
- `deploy.yml`: a separate `cad-cli` job restores or builds the CLI from a deploy-only cache key
  (`deploy-cad-cli-<tree>`, written only on main), so a pull request can never supply the
  production binary; the production job downloads it before `wrangler deploy` builds the image.

## Not in scope

- Converting legacy Python models to designs.
- MantelCAD's own glTF export (would remove the OCCT import for the viewer mesh).
- Giving external MCP agents MantelCAD tools.
