# MantelDocs development

Repository: https://github.com/ichen27/manteldocs (private).
Upstream: https://github.com/storytold/cadcraft; retain its Git history and the `upstream` remote.

## Architecture and scope
Pure Rust workspace: geometry/DXF at L0, color/doc at L1, fonts/render/constraints at L2, I/O at L3, engine at L4, UI/MCP at L5, then desktop/CLI/web apps. Preserve `cargo xtask layers`. UI acts through engine commands; do not move drawing logic into widgets. Do not change CAD behavior as part of branding work.

Use the package names `manteldocs*`, executable names `manteldocs` and `manteldocs-cli`, and app ID `com.manteldocs.app`. Never reconnect the upstream updater: it assumes ArtCraft paths and identities. Preserve upstream license notices, dependency names and CADCRAFT DXF extension identifiers (file compatibility, not display branding). Attribute new assets in ATTRIBUTION.md.

## Setup and checks
See README.md. Rust 1.95+, wasm32-unknown-unknown. `cargo run -p manteldocs -- --sample` launches the app. `bash ci/run.sh` runs `cargo xtask ci`. The web entry point is apps/manteldocs-web. No production panics or unsafe code; return errors and bound input-derived work.

## Delivery
Use focused branches and PRs; no implementation pushes directly to main. Commit as ichen27 <ivan27chen@gmail.com>. Keep repository private. Review the diff and require current passing checks before merge; never bypass failed checks. Report unavailable branch protection or hosted billing. Source and useful artifacts must be pushed before handoff. No deployment, signing credentials, model review, or upstream organization automation is configured.
