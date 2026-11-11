#!/usr/bin/env bash
# Fetches the external build inputs an engine pins, and prints the environment its build reads:
# craft-i18n (translations; engines with craft-i18n.rev) for CRAFT_I18N_DIR, and craft-fonts
# (the bundled font set, at the commit the engine's own workflows pin) for CRAFT_FONTS_DIR. They
# are public storytold repositories; without them an engine builds English-only with fewer fonts.
# Usage: engines/fetch-inputs.sh <engine> <dir>   (prints NAME=value lines, e.g. >> "$GITHUB_ENV")
set -euo pipefail
fetch() { # <repo> <rev> <target>
  [[ "$2" =~ ^[0-9a-f]{40}$ ]] || { echo "bad revision for $1: $2" >&2; exit 1; }
  if [ ! -d "$3/.git" ]; then
    git init -q "$3"
    git -C "$3" remote add origin "https://github.com/storytold/$1.git"
  fi
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q --detach FETCH_HEAD
}
engine="${1:?engine}"
dir="${2:?directory}"
root="$(cd "$(dirname "$0")/.." && pwd)"
rev_file="$root/engines/$engine/craft-i18n.rev"
if [ -f "$rev_file" ]; then
  fetch craft-i18n "$(tr -d '[:space:]' < "$rev_file")" "$dir/craft-i18n"
  echo "CRAFT_I18N_DIR=$dir/craft-i18n"
  echo "CRAFT_I18N_REQUIRED=1"
fi
# The craft-fonts commit each engine's own workflows pin (craft-fonts-ref).
case "$engine" in
  mantelpdf) fonts=b076417b5880bd4154bd22f00695b1d28c6bea83 ;;
  *) fonts="" ;;
esac
if [ -n "$fonts" ]; then
  fetch craft-fonts "$fonts" "$dir/craft-fonts"
  echo "CRAFT_FONTS_DIR=$dir/craft-fonts"
fi
