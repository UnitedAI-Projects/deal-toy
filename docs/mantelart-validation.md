# MantelArt validation

Date: November 10, 2026. Upstream base: 3776100ba612591aa57fdbc4405dbd456ef7c5df.

## Passed

- Native application and CLI compilation, followed by a successful runnable desktop/CLI build.
- Full workspace formatting and Clippy with warnings denied.
- Live welcome/About/drawing screens inspected on the Mac mini; transferred application launched and verified on the MacBook.
- CLI help/version and MCP initialization identify MantelArt.
- Existing Neon Drive document opened without warnings; native save/reopen and SVG export preserved the SVG view box and element count.
- Mac preview ad-hoc signature verification passed before and after transfer. Both copies have SHA-256 e1f1b6fc5f4815a966b1a0dd2be5d75a195aed1e1acb6989a70ef5298268e7e9.
- Negative audit test: restoring an old VectorCraft web title in an isolated snapshot was rejected.
- macOS plist validation, 11 packaging shell syntax checks and Linux package identity consistency.
- MantelArt identity audit: displayed names, executable package names, web title, macOS bundle ID, file associations, XML and duplicate translation keys.
- Asset attribution: all 329 asset files accounted for.
- Vendor-name check and architecture layers: all 30 crates accepted.
- Lockfile comparison: only the three application package names changed; dependency versions and sources are unchanged.
- Icon generation (SVG, PNG, ICO and ICNS) and macOS DMG background regeneration.
- Diff whitespace check.

This report records the native-preview validation checkpoint. See [pull request #1](https://github.com/ichen27/mantelart/pull/1) for the latest full Rust test, wasm and hosted CI results. A development preview is not a production release.

## CI configuration and limits

The Checks workflow uses Ubuntu 24.04 with read-only permissions, pinned checkout, PR/default-branch/manual triggers, cancellation and a 90-minute timeout for the inherited large Rust suite. The local and remote command is bash ci/run.sh. This adapts CI standard 65afb2499668568dd71f8e7cc02674877cb5041d; its recorded validation and rollout status were inspected. Upstream release/integration workflows are retained as inert text in docs/upstream-workflows.

The billing API could not report private Actions allowance with the current token (missing user scope). The real PR run successfully started and reached project validation, establishing hosted execution availability; no claim about remaining allowance is made. GitHub rejected branch protection with HTTP 403 because the current plan does not support it for private repositories. Protection is not enabled. No visibility or billing settings were changed.

Windows/Linux installer execution, code signing, notarization and automatic update installation are not verified. Automatic updates remain disabled; manual updates open this repository's releases page. Existing format/automation identifiers and third-party attribution are intentionally retained.
