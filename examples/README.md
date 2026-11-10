# Example artifacts

The bridge study is synthetic demonstration geometry, 100 × 55 × 51 mm. It is not an approved customer design or a manufacturing specification.

| File                             | Purpose                                  | Open with                    |
| -------------------------------- | ---------------------------------------- | ---------------------------- |
| [bridge.py](bridge.py)           | Editable build123d source                | Python editor / CAD runtime  |
| [model.step](exports/model.step) | Exact solid exchange geometry            | STEP-capable CAD application |
| [model.stl](exports/model.stl)   | Triangulated mesh                        | Slicer or mesh viewer        |
| [model.glb](exports/model.glb)   | Browser-ready visual preview             | glTF viewer / app workspace  |
| [facts.json](exports/facts.json) | Bounds, volume, solids and review status | JSON reader                  |

Reproduce from the repository root:

```sh
uv run --project engine python engine/runner.py examples/bridge.py examples/exports
```

The STEP round-trip test reopens the export and checks its validity, bounds and volume. Export byte identity is not promised: geometry equivalence is the current contract.

## Steps layout

[deal_toy_steps.py](deal_toy_steps.py) is the reference model for modeling actions: `base()` returns the starting parts as free Python, and `build()` runs one `m.<action>("Name", ...)` call per step between the `# mantel:steps begin` and `# mantel:steps end` markers. Mantel's step tools edit only that section, and every build reports each step's state (`ok`, `warning`, `failed`, `blocked` or `suppressed`) in `facts.json`. The text step needs the Liberation fonts that the CAD image installs.

```sh
uv run --project engine python engine/runner.py examples/deal_toy_steps.py work/deal-toy
```

## Tea cup: design sheet and layers

[tea_cup_steps.py](tea_cup_steps.py) is the reference for the enforced structure: every part of the cup is a layer in the steps section and `base()` returns `None`. Its layers are, in order, the framework of [tea_cup_design.json](tea_cup_design.json), a valid `design_start` input with the questioned sections (one of them `assumed`). It uses the `loft`, `shell`, `revolve`, `fillet`, `sweep` and `appearance` actions, and `CUP_HEIGHT`, `RIM_DIAMETER`, `BASE_DIAMETER` and `WALL` in `PARAMS` drive its size. It is synthetic demonstration geometry, about 106 × 84 × 95 mm, not a manufacturing design.

| File                                         | Purpose                                        | Open with                    |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------- |
| [tea_cup_steps.py](tea_cup_steps.py)         | Editable source in the steps layout            | Python editor / CAD runtime  |
| [tea_cup_design.json](tea_cup_design.json)   | Design sheet: request, sections and framework  | JSON reader / `design_start` |
| [model.step](exports/tea_cup/model.step)     | Exact solid exchange geometry                  | STEP-capable CAD application |
| [model.stl](exports/tea_cup/model.stl)       | Triangulated mesh                              | Slicer or mesh viewer        |
| [model.glb](exports/tea_cup/model.glb)       | Browser preview with the glaze colour          | glTF viewer / app workspace  |
| [facts.json](exports/tea_cup/facts.json)     | Bounds, step states, parts with colour, PARAMS | JSON reader                  |
| [inspect.json](exports/tea_cup/inspect.json) | Inspection record                              | JSON reader                  |

```sh
uv run --project engine python engine/runner.py examples/tea_cup_steps.py examples/exports/tea_cup
```

## Inspection fixture

[deal_toy_inspect.py](deal_toy_inspect.py) is a synthetic deal toy with deliberate faults for the inspection tests. A brass coin sits off-centre in an acrylic block only 1.5 mm behind its front face, the block is tall for its base, and the engraving is 0.3 mm deep against a declared 0.5 mm. It declares `MATERIALS`, `EMBEDS` and a `dimensions()` function, so its build reports stability, the embed wall and the engraving depth.

## Presentation-box fixture

[display_box_fit.py](display_box_fit.py) is a synthetic presentation box for a deal toy, used to test joints. The lid turns on a `RevoluteJoint` along the back top edge (`LID_ANGLE`, 0–110°), the drawer slides out on a `LinearJoint` (`DRAWER_OUT`, 0–40 mm), and a plaque is fixed to the lid with a `RigidJoint`, so it moves with the lid. Every boolean comes before the joints, and `connect_to` reads its angle and position from `PARAMS`. `dimensions()` declares both as placements (`{"name", "param", "joint"}`), so they can be typed or dragged in the viewer. Its stored records, `engine/tests/fixtures/display_box_fit.inspect.json` and `display_box_fit_posed.inspect.json` (lid at 60°, drawer out 25 mm), let the viewer's joint math be checked against build123d's.

## Enclosure fixture

[enclosure_inspect.py](enclosure_inspect.py) reproduces the injection-moulded enclosure faults from the published copilot test, as synthetic geometry. Its ribs run into the screw bosses, no wall has draft along `PULL = {"Housing": (0, 0, 1)}`, and the cover's lip sits 0.30 mm from the housing wall. `dimensions()` declares the wall thickness (`WALL_T`) and the lip clearance (`LIP_GAP`), so both can be typed or dragged in the viewer. The engine and Worker tests use its stored record, `engine/tests/fixtures/enclosure_inspect.inspect.json`; regenerate it with `engine/tools/gen_fixtures.py`.

## Saved action

[saved_actions/finger_notch.py](saved_actions/finger_notch.py) is a reference custom action. Its `@mt.action` decorator describes it the same way the built-in catalog describes its actions: summary, described inputs, created names and an example. Save it through the `actions_save` tool; Mantel builds the model with the example appended and lists the action once the example step is `ok`.

## Brand model

[brand/](brand/README.md) holds the Mantel name shown on the sign-in screen: its build123d source, exports and the bundled Inter font with its license.
