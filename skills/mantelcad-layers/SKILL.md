---
name: mantelcad-layers
description: "Use when deciding whether code goes in MantelCAD or in solidcore (the vendored kernel in solidcore/), and in which solidcore crate: geometry, a modelling workflow, kernel work, or a review comment about the layer split."
---

# Where code goes: MantelCAD or solidcore

The authority is `solidcore/docs/layers.md`; this is its short form. Every job lives in exactly one layer, and two implementations of one job are a bug.

## Decide
1. **Does it compute geometry?** Anything computed from coordinates: a point, vector, length, angle, curvature, curve or surface, a solve, an intersection, a fit, a mesh, a STEP parse. Then it is a kernel primitive in `solidcore/crates/solidcore`, with its own tests. Dot and cross products, normalising, square roots or trigonometry on coordinates count, however small.
2. **Is it a workflow recipe of kernel calls?** It picks entities, parameters and defaults, sequences kernel calls, compares what they return with tolerances and reports. Then it is `solidcore/crates/solidcore-ops`. Ops computes no geometric quantity of its own: when it needs one the kernel lacks, add a kernel primitive and call it.
3. **Is it state, selection, commands, settings, history or UI?** Then it is MantelCAD (`crates/`, `apps/`), which computes no geometry.

## What MantelCAD may use
- `solidcore-ops` (modelling), `solidcore-tess` (display meshes, polylines) and `solidcore-record` (geometry as data). CI enforces this seam through `cargo xtask layers` (#13498): solidcore's public API is listed in xtask/solidcore-public.txt, and the remaining direct uses in xtask/solidcore-seam.txt, a list that only shrinks. The same command keeps solidcore/ self-contained: no manifest under it may use a `path` that leaves solidcore/ or depend on a `mantelcad-*` crate, and kernel changes should also run `cargo check --workspace --all-targets --locked` from `solidcore/`. The fork gate does not claim a separate kernel-export CI job.
- Before writing STEP, meshing, surface intersection, tangent chains or frames, look for solidcore's: a second implementation is flagged.

## Lists that only shrink
- `xtask/mesh-decisions.txt`: model decisions made from a mesh (`cargo xtask mesh-decisions`).
- `solidcore/plan/panic-sites.tsv`: panic-prone calls in solidcore; validate them with the kernel's documented checks.

## Working in solidcore/
- Follow `solidcore/AGENTS.md` and the area's references in `solidcore/docs/`. Run the kernel's relevant tests, goldens, rig, clippy, formatting and panic-site checks; the fork's `.github/workflows/checks.yml` runs the narrower `ci/run.sh` gate.
- New kernel cases go in `solidcore/crates/solidcore/tests/kernel_cases/`, not the application tests (`cargo xtask lists`).
- Open a focused PR against MantelCAD's `main` and follow `CONTRIBUTING.md`. Record kernel-specific validation and request the appropriate review; `.github/CODEOWNERS` identifies this fork's owner.
- There is no automatic mirror to the upstream kernel repository. Preserve upstream provenance and keep any upstream contribution separate from the MantelCAD PR.
