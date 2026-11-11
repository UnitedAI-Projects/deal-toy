# MantelMesh contributor guide

A Rust workspace inside Mantel (`engines/mantelmesh`). Layers, from the bottom: `mesh` → `ops` → `doc` → `io` → `engine` → apps. A crate depends only on lower layers.

- Every user-visible action is an engine command in `crates/engine` with a description and inputs. No UI-only edits.
- Edits are pure functions in `crates/ops`: they never edit in place and never panic on user input. Invalid requests return an error naming what was wrong.
- After any topology change, `Mesh::check()` must stay clean for closed inputs. Add a test for every new operation, including it in the randomised sequence test.
- No `unsafe`, `unwrap` or `panic` outside tests. Bound input-derived work (segments, file sizes).
- Do not link MantelCAD's `ui-kit`, `look` or `theme` crates. They are brand-licensed.

Validate with `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings` and `cargo test --workspace --locked`.
