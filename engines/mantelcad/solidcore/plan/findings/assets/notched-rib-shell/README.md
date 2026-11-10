# Notched rib shell evidence

The **before** pictures show the solid input. The old shell operation refused
this input; no failed or invalid shell is presented as a rendered result.
The **after** pictures show the successful 0.5 mm shell.

| View | Solid input | Successful shell |
| --- | --- | --- |
| Whole part | [input.png](input.png) | [shell.png](shell.png) |
| Rib opening | [input-detail.png](input-detail.png) | [shell-detail.png](shell-detail.png) |
| Section at y=6 | [input-section.png](input-section.png) | [shell-section.png](shell-section.png) |

Each pair uses the same camera, 900 × 700 resolution, and native GPU snapshot
renderer. The section retains y ≤ 6; hatching marks cut material. It exposes
the cavity and retained floor beneath the opening.

- [input.json](input.json): editable five-command box/boolean construction.
- [shell.json](shell.json): the same construction followed by the shell command.
- [views.json](views.json): camera values for each view.
- [results.json](results.json): original historical failure and measured results,
  with the independent reduced-model expectations.
- [Finding and analytic proof](../../offset.offset_executive_p2--notched-rib-single-loop-floor.md).

From the repository's `engines/mantelcad` directory, build with
`cargo build --locked --profile ci -p mantelcad-cli`. Run either command script
with `mantelcad-cli eval FILE.json --validation each_step`, using the built
executable on your PATH. To reproduce a picture, use
`mantelcad-cli snapshot FILE.json --out IMAGE.png --width 900 --height 700
--camera 'CAMERA_JSON' --no-grid --no-axes`, replacing CAMERA_JSON with the
corresponding object in views.json. Add `--section y=6` for the section pair.
