#!/usr/bin/env bash
# The kernel is a nested workspace; the outer CAD workspace does not run its tests.
set -euo pipefail
cd "$(dirname "$0")/../solidcore"
# Rustup resolves this workspace's checked-in pin from the working directory.
rustup show active-toolchain
status=0
cargo test --locked --profile goldens -p solidcore \
  --test fork_1b016ca_cavity_floor_under_opening || status=1
cargo test --locked --profile goldens -p solidcore \
  --lib offset::offset_executive::crossing_loops::single_loop_tests || status=1
cargo run --locked --profile goldens -p goldens -- \
  --unit offset.offset_executive_p2 --goldens || status=1
exit "$status"
