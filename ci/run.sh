#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 ci/branding.py
cargo xtask ci
