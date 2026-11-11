#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 ci/check-branding.py
cargo fmt --all -- --check
# Use one profile so native executables and regression tests share compiled dependencies.
cargo build --locked --profile ci -p mantelcad -p mantelcad-cli
cargo test --locked --profile ci -p mantelcad-doc --lib format::tests
cargo test --locked --profile ci -p mantelcad-io --lib formats::tests
cargo test --locked --profile ci -p mantelcad-ui-egui --lib update::tests
cargo test --locked --profile ci -p mantelcad-ui-egui --lib stored_prefs_are_isolated_from_upstream
cargo test --locked --profile ci -p mantelcad-cli --test run_results legacy_extension_and_format_tag_still_open
cargo test --locked --profile ci -p mantelcad-cli --test run_results cli_loads_both_design_encodings_by_contents
cargo test --locked --profile ci -p mantelcad-engine --lib agent_setup::tests
cargo test --locked --profile ci -p mantelcad-cli --test help_output
cargo test --locked --profile ci -p mantelcad-ui-egui --lib keymap::tests
cargo test --locked --profile ci -p mantelcad-ui-egui --lib navigation_bar_view::tests
cargo test --locked --profile ci -p mantelcad-ui-egui --lib settings_profiles_tests
cargo test --locked --profile ci -p mantelcad-geom --lib env::tests
cargo test --locked --profile ci -p mantelcad-io --lib native_cache_round_trip_and_preview_defer_original_sources
cargo test --locked --profile ci -p mantelcad-io --lib portable_thumbnail_is_keyed_bounded_and_does_not_read_sources
