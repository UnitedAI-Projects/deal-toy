# MantelDocs validation — November 10, 2026

## Verified

- Formatting and native Clippy with warnings denied passed.
- The browser application built successfully with Trunk and loaded in Chrome on the client computer through a private SSH port forward. Title, Help/About, the sample drawing label, circle creation and undo were checked. [Screenshot](images/manteldocs-workspace.jpg).
- `cargo xtask wasm` passed. Three inherited unused/dead-code warnings remain in the WASM UI build.
- Workspace doctests, asset attribution and dependency layering passed.
- The native CLI reports `manteldocs-cli 0.17.0 (dev)`, opens `examples/apartment.dxf`, and exports the sample drawing as PNG.
- The browser ZIP passed CRC checks, was extracted, and its documented static-server quickstart and HTML asset URLs were checked. The transferred download has the same SHA-256 as the repository artifact.
- The renamed test fixtures and legacy drafting-font compatibility test were exercised in the full native regression run.

## Native test limitations

The complete native suite was run with `cargo test --workspace --lib --bins --tests --no-fail-fast`. It is **not reported as fully passing on this macOS host**:

- `usage::non_unicode_output_names` and `read_file_refuses_a_name_that_is_not_unicode` try to create a non-UTF-8 filename. macOS rejects that filename with `Illegal byte sequence (os error 92)`; a separate direct filesystem probe reproduced the rejection.
- `complex::tests::thai_marks_stack_in_an_installed_font` fails an installed-font-dependent Thai shaping assertion. The shaping implementation is unchanged apart from crate-name references; a clean upstream environment was not separately rebuilt to establish its baseline.

The group-reading timing test also failed during the full run while other compilation was active (16× the groups took 123.7× as long). It passed when rerun alone using the same test binary. This is recorded as a timing-sensitive result, not silently counted as an all-green suite.

No test was deleted, ignored or weakened to hide these results. The [PR checks](https://github.com/ichen27/manteldocs/pull/1/checks) are the authority for the current hosted Linux revision. Do not merge while checks fail or are pending.

## Scope and operational limits

This is a branding fork, not a new CAD engine or a claim of production readiness. Existing DWG fidelity and other upstream gaps remain. Desktop and web Rust code were checked on Apple silicon macOS; Windows/Linux installers and signing/notarization were not exercised.

GitHub returned HTTP 403 for private branch protection under the account's plan, so enforcement is not claimed. The workflow still requires review and a passing current PR revision before merge. Hosted tests use an Ubuntu runner, read-only permissions and a pinned checkout action. The 90-minute timeout is an explicit allowance for a cold Rust native/WASM build; model review and deployment are not configured.

The preview ZIP is a development browser build. It is not a signed native installer.

## Documentation naming follow-up (2026-11-10)

- Audited all tracked file/directory names: no CADCraft or ArtCraft names remain in paths.
- Checked local Markdown link destinations, including the relocated historical migration record: all resolve.
- Reviewed remaining original-brand text: retained for provenance, real upstream dependencies, and drawing-format compatibility.
- Corrected stale release/CI instructions, Windows installation directory naming, browser embedding title, and contributor documentation.
- Asset attribution check passed for all 20 assets; original MIT and Apache license files match the upstream revision byte-for-byte.
- Refreshed the preview ZIP's NOTICE and ATTRIBUTION.md; ZIP integrity and packaged document contents passed. The MacBook copy matches the recorded SHA-256.
- This follow-up changes documentation and bundled notices only. Native application tests were not rerun; the earlier results above still apply. Hosted checks rerun on the updated PR revision.
