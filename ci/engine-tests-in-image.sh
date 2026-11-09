#!/usr/bin/env bash
# Runs the engine test suite inside the CAD image (Linux, Liberation fonts), after
# `docker build -f engine/Dockerfile -t deal-toy-cad:test .`. pytest is added to a scratch path only;
# the image itself is unchanged. Needs network access to fetch pytest.
set -euo pipefail
docker run --rm -v "$PWD:/repo:ro" --tmpfs /tmp:rw,exec,size=2g -e HOME=/tmp -w /tmp deal-toy-cad:test sh -c '
  mkdir -p /tmp/w/examples && cp -r /repo/engine /tmp/w/ && cp /repo/examples/*.py /tmp/w/examples/
  cp -r /repo/examples/saved_actions /tmp/w/examples/
  uv pip install -q --target /tmp/pt --python /opt/cad/.venv/bin/python pytest
  cd /tmp/w && PYTHONPATH=/tmp/pt /opt/cad/.venv/bin/python -m pytest engine/tests -q -p no:cacheprovider'
