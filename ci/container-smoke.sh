#!/usr/bin/env bash
set -euo pipefail
# Runs a known synthetic model, never submitted customer code, with no network or credentials.
docker run --rm --network none --memory 4g --cpus 2 --pids-limit 96 --read-only \
  --hostname "$(python3 -c 'print("c" * 64)')" \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "$PWD/examples:/examples:ro" \
  -v "$PWD/ci/container-smoke.py:/opt/cad/smoke.py:ro" \
  deal-toy-cad:test /opt/cad/.venv/bin/python /opt/cad/smoke.py
