# MantelCAD development

Repository: `https://github.com/ichen27/mantelcad`. [README.md](README.md) covers setup; [CONTRIBUTING.md](CONTRIBUTING.md) governs validation and delivery. These fork instructions supersede inherited claim bots, sponsorship, release automation and merge-queue procedures.

## Work and delivery

1. Inspect branch, remotes and uncommitted work. Use a focused branch and preserve unrelated work.
2. Run `bash ci/run.sh` and affected tests. Use `cargo xtask ci` for broader application, geometry, dependency or cross-platform changes; report incomplete checks.
3. Review the diff, push the branch and open a PR against `main`. Merge only after current checks and required reviews pass; verify GitHub and local state afterward.
4. Keep source, editable artwork, consumed exports, examples and relevant evidence. Update [the artifact index](docs/ARTIFACTS.md); exclude credentials, private designs and build caches.

## Invariants

- Applications live in `apps/`, shared crates in `crates/`, the separately attributed kernel in `solidcore/`, and patched dependencies in `vendor/`. Read [layers](docs/layers.md) before changing boundaries.
- Modeling uses the shared command system with explicit errors and hostile-input handling.
- Preserve serialized `solidcraft/N` namespaces and `.sc`, `.solidcraft`, `.solvecraft` compatibility. Format changes need migrations and tests.
- Product identity: MantelCAD; binaries: `mantelcad`, `mantelcad-cli`; app ID: `com.ichen27.mantelcad`. Retain upstream names in legal notices, provenance, historical references and file formats.
- Read [fork provenance](docs/mantelcad-fork.md) before upstream imports. This source includes `LICENSE-BRAND`; the owner reports written permission for MantelCAD. Preserve original licenses and keep permission claims within that record.
- For assets read `assets/AGENTS.md`; for UI icons also read `crates/look/icons/AGENTS.md` and `crates/look/icons/STYLE_GUIDE.md`. Keep source and consumed exports together, record attribution, and run `cargo xtask assets` and `cargo xtask icons`.

## Task router

Read the matching skill before working in its area. Fork delivery and licensing rules above take precedence over inherited upstream procedures.

| Work | Skill |
| --- | --- |
| Run the app, control channel or MCP | `skills/mantelcad-agent-tools/SKILL.md` |
| Validate or port a CAD design | `skills/mantelcad-checking/SKILL.md` |
| Commands and programmatic behavior | `skills/mantelcad-commands/SKILL.md` |
| Contribute or review a PR | `skills/mantelcad-contributing/SKILL.md` |
| Rust errors, hostile inputs or crashes | `skills/mantelcad-crash-safety/SKILL.md` |
| Change an existing CAD design | `skills/mantelcad-editing/SKILL.md` |
| Design persistence, import or export | `skills/mantelcad-file-formats/SKILL.md` |
| Licenses, dependencies or provenance | `skills/mantelcad-ground-rules/SKILL.md` |
| Application/kernel code boundaries | `skills/mantelcad-layers/SKILL.md` |
| Assemblies, joints or motion | `skills/mantelcad-mechanisms/SKILL.md` |
| Build a new part through MCP | `skills/mantelcad-modeling/SKILL.md` |
| Prepare packages or releases | `skills/mantelcad-packaging/SKILL.md` |
| Slow work, window thread or wasm | `skills/mantelcad-performance/SKILL.md` |
| Preferences or changed defaults | `skills/mantelcad-preferences/SKILL.md` |
| Reproduce and report a CAD problem | `skills/mantelcad-reporting/SKILL.md` |
| Sheet-metal modeling | `skills/mantelcad-sheetmetal/SKILL.md` |
| Place or run tests | `skills/mantelcad-tests/SKILL.md` |
| Dialogs, panels, camera or icons | `skills/mantelcad-ui/SKILL.md` |
| Labels, messages or translations | `skills/mantelcad-ui-text/SKILL.md` |
