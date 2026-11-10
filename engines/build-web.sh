#!/usr/bin/env bash
# Builds one engine's browser app into dist/apps/<engine>/, served by Mantel at /apps/<engine>/.
# Usage: engines/build-web.sh <manteldocs|mantelcad|mantelart|mantelpdf> [out-dir]
# Needs Rust 1.99.1 with wasm32-unknown-unknown and Trunk 0.22.1 on PATH.
set -euo pipefail
engine="${1:?engine name}"
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$engine" in
  manteldocs) app=apps/manteldocs-web ;;
  mantelcad) app=apps/mantelcad-web ;;
  mantelart) app=apps/vectorcraft-web ;;
  mantelpdf) app=apps/pdfcraft-web ;;
  *)
    echo "unknown engine: $engine" >&2
    exit 2
    ;;
esac
out="${2:-$root/dist/apps/$engine}"
mkdir -p "$out"
cd "$root/engines/$engine/$app"
trunk build --release --locked --public-url "/apps/$engine/" --dist "$out"
echo "built $engine into $out ($(du -sh "$out" | cut -f1))"
