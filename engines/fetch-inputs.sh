#!/usr/bin/env bash
# Fetches the external build inputs an engine pins, and prints the environment its build reads:
# craft-i18n (translations; engines with craft-i18n.rev) for CRAFT_I18N_DIR. They are public
# storytold repositories; without them an engine builds English-only.
# Usage: engines/fetch-inputs.sh <engine> <dir>   (prints NAME=value lines, e.g. >> "$GITHUB_ENV")
set -euo pipefail
engine="${1:?engine}"
dir="${2:?directory}"
root="$(cd "$(dirname "$0")/.." && pwd)"
rev_file="$root/engines/$engine/craft-i18n.rev"
if [ -f "$rev_file" ]; then
  rev="$(tr -d '[:space:]' < "$rev_file")"
  [[ "$rev" =~ ^[0-9a-f]{40}$ ]] || { echo "bad craft-i18n.rev: $rev" >&2; exit 1; }
  target="$dir/craft-i18n"
  if [ ! -d "$target/.git" ]; then
    git init -q "$target"
    git -C "$target" remote add origin https://github.com/storytold/craft-i18n.git
  fi
  git -C "$target" fetch -q --depth 1 origin "$rev"
  git -C "$target" checkout -q --detach FETCH_HEAD
  echo "CRAFT_I18N_DIR=$target"
  echo "CRAFT_I18N_REQUIRED=1"
fi
