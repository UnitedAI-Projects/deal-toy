# Mantel name model

The 3D name on the sign-in screen is a Mantel model: [name.py](name.py) is ordinary build123d source with declared `PARAMS`, built by the same runner as any project revision. The app serves its GLB export as [`public/brand/mantel-name.glb`](../../public/brand/mantel-name.glb).

| File                             | Purpose                                                   | Open with                   |
| -------------------------------- | --------------------------------------------------------- | --------------------------- |
| [name.py](name.py)               | Editable source: the name and the diamond mark, two parts | Python editor / CAD runtime |
| [model.step](exports/model.step) | Exact solid geometry                                      | STEP-capable CAD software   |
| [model.stl](exports/model.stl)   | Triangulated mesh                                         | Slicer or mesh viewer       |
| [model.glb](exports/model.glb)   | Preview used by the sign-in screen                        | glTF viewer                 |
| [facts.json](exports/facts.json) | Bounds, solids, parts and parameters                      | JSON reader                 |
| [fonts/](fonts/)                 | Inter Display Bold and its SIL Open Font License          | Font viewer                 |

The model is about 259 × 22 × 68 mm. The mark's edges are chamfered; OCCT refuses a chamfer on some glyph corners, so the letters keep sharp edges rather than a mix.

Rebuild from the repository root, then copy the GLB the app serves:

```sh
uv run --project engine python engine/runner.py examples/brand/name.py examples/brand/exports
cp examples/brand/exports/model.glb public/brand/mantel-name.glb
```
