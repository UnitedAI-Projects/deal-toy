# MantelArt contributor instructions

Repository: https://github.com/ichen27/mantelart (private).
Upstream: https://github.com/storytold/vectorcraft. This is an independent derivative.

## Workflow

1. Inspect branch, remotes and working tree before editing. Preserve unrelated changes.
2. Read README.md for setup and docs/architecture.md when changing module boundaries.
3. Work on a focused branch. Run bash ci/run.sh before committing, then inspect the diff.
4. Push and open a pull request. Merge only with current passing checks and required reviews. Report blocked or unavailable checks explicitly.
5. Commit as ichen27 <ivan27chen@gmail.com>. Preserve third-party notices; add no tool/model attribution.

## Architecture and compatibility

Rust workspace: crates/ contains geometry, document model, renderer, engine and thin egui frontend. apps/vectorcraft, apps/vectorcraft-cli and apps/vectorcraft-web build the mantelart, mantelart-cli and mantelart-web executables. Directory and internal library names remain upstream-compatible.

User-visible actions go through engine commands. Keep the frontend thin and layer dependencies enforced by cargo xtask layers. Production errors return Result/Option; preserve no-panic and unsafe-code lints.

Use MantelArt for displayed names, icons, packaging and project links. Keep .vectorcraft/.drawcraft envelopes and internal protocol identifiers compatible. MantelArt has its own settings directories, installer upgrade identity and bundle ID. Manual updates link only to this repository; automatic installation stays off until the independent update channel is validated.

## Assets and checks

Every new asset must be original or redistributable and recorded in ASSETS.md and ATTRIBUTION.md. Preserve LICENSE-MIT, LICENSE-APACHE, NOTICE and dependency licenses. The upstream restricted marks are removed; their retained license is historical evidence, not permission to reuse them.

Use cargo fmt --all, focused Rust tests and bash ci/run.sh. Visually inspect UI changes. Run cargo xtask bundle on macOS for the native bundle and Trunk in apps/vectorcraft-web for the web artifact. Index artifacts and limitations in docs/mantelart-artifacts.md.

Keep CI read-only, pinned and separate from deployment. Never publish releases, change visibility or introduce provider credentials as part of routine branding work.
