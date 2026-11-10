#!/usr/bin/env bash
# Builds MantelCAD's headless CLI for Mantel's CAD container into engine/bin/mantelcad-cli.
#
# The container runs python:3.12-slim-bookworm on linux/amd64, so the CLI is built inside
# rust:<toolchain>-bookworm for that platform: its glibc then matches the runtime's.
#
#   bash engines/build-cad-cli.sh            # any host with Docker (Apple silicon emulates amd64)
#
# The build only links the geometry kernel's dependencies the CLI needs; no GPU is used at run time.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
toolchain=${RUST_TOOLCHAIN:-1.99.1}
out="$root/engine/bin"
mkdir -p "$out"
docker run --rm --platform linux/amd64 \
  -v "$root/engines/mantelcad:/src:ro" \
  -v "$out:/out" \
  -v "${CAD_CLI_TARGET_VOLUME:-mantelcad-cli-target}:/target" \
  -v "${CAD_CLI_REGISTRY_VOLUME:-mantelcad-cli-registry}:/usr/local/cargo/registry" \
  -e CARGO_TARGET_DIR=/target \
  -e CARGO_PROFILE_RELEASE_DEBUG=false \
  -e CARGO_PROFILE_RELEASE_STRIP=symbols \
  -e CARGO_INCREMENTAL=0 \
  -w /src "rust:$toolchain-bookworm" \
  bash -c 'cargo build --release --locked -p mantelcad-cli && install -m 0755 /target/release/mantelcad-cli /out/mantelcad-cli'
ls -la "$out/mantelcad-cli"
