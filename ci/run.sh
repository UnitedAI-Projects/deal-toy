#!/usr/bin/env bash
set -euo pipefail
npm run format:check
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
uv sync --project engine --python 3.12 --frozen
uv run --project engine ruff check engine examples
uv run --project engine pytest engine/tests -q
npx wrangler deploy --dry-run --containers-rollout none --outdir work/worker-build
