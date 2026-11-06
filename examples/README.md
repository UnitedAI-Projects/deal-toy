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

## Brand model

[brand/](brand/README.md) holds the Mantel name shown on the sign-in screen: its build123d source, exports and the bundled Inter font with its license.
