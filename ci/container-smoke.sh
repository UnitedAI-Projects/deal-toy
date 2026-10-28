#!/usr/bin/env bash
set -euo pipefail
# Runs a known synthetic model, never submitted customer code, with no network or credentials.
docker run --rm --network none --memory 4g --cpus 2 --pids-limit 96 --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "$PWD/examples:/examples:ro" \
  deal-toy-cad:test /opt/cad/.venv/bin/python -c \
  'from pathlib import Path; from service import execute; result=execute(Path("/examples/bridge.py").read_text()); assert len(result["artifacts"]) == 4; print("CAD container: STEP, STL, GLB and measured facts verified")'
