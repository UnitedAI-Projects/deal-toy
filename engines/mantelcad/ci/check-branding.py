#!/usr/bin/env python3
"""Validate product identity without changing interoperable CAD format identifiers."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tomllib

REPO = "https://github.com/ichen27/mantelcad"
APP_ID = "com.ichen27.mantelcad"


def validate(root: Path) -> list[str]:
    errors: list[str] = []

    def require(ok: bool, message: str) -> None:
        if not ok:
            errors.append(message)

    def read(name: str) -> str:
        return (root / name).read_text(encoding="utf-8")

    try:
        workspace = tomllib.loads(read("Cargo.toml"))
        require(workspace["workspace"]["package"]["repository"] == REPO,
                "Cargo workspace repository must identify MantelCAD")
        for name in ("mantelcad", "mantelcad-cli", "mantelcad-web"):
            manifest = tomllib.loads(read(f"apps/{name}/Cargo.toml"))
            require(manifest["package"]["name"] == name, f"wrong package identity: {name}")
        for manifest in sorted((root / "crates").glob("*/Cargo.toml")):
            name = tomllib.loads(manifest.read_text())["package"]["name"]
            require(name.startswith("mantelcad-"), f"unbranded workspace crate: {name}")

        web = json.loads(read("apps/mantelcad-web/manifest.webmanifest"))
        require(web["name"] == "MantelCAD" and web["short_name"] == "MantelCAD",
                "web manifest must display MantelCAD")
        require(all(APP_ID in icon["src"] for icon in web["icons"]),
                "web manifest must use MantelCAD icon IDs")
        desktop = read(f"assets/platforms/linux/{APP_ID}.desktop")
        require("Name=MantelCAD" in desktop and "Exec=mantelcad" in desktop,
                "desktop entry must launch and display MantelCAD")
        plist = read("assets/platforms/macos/Info.plist.in")
        require(APP_ID in plist and "MantelCAD" in plist, "macOS bundle identity is inconsistent")
        html = read("apps/mantelcad-web/index.html")
        require("<title>MantelCAD</title>" in html, "web page title must display MantelCAD")
        require(not re.search(r"(?:solidcraft\.io|tangencylabs|tangency-labs)", html, re.I),
                "web entry page still points to upstream identity or services")

        # Check production updater declarations only. Regression tests deliberately mention
        # rejected upstream URLs and must remain able to do so.
        updater = read("crates/ui-egui/src/update.rs")
        repo = re.search(r'pub const REPO: &str = "([^"]+)"', updater)
        require(repo is not None and repo[1] == "ichen27/mantelcad", "updater targets another repository")
        allowlist = re.search(r"const RELEASE_PREFIXES:[^\r\n]+", updater)
        require(allowlist is not None and REPO + "/releases/" in allowlist[0],
                "release allowlist lacks MantelCAD")
        if allowlist:
            require("solidcraft" not in allowlist[0].lower() and "bherbruck" not in allowlist[0],
                    "updater must never accept upstream application replacements")
        require(not (root / "packaging/web/transfer/app-transfer.js").exists(),
                "upstream web-storage transfer must not ship with MantelCAD")

        formats = read("crates/doc/src/format.rs")
        require('prefix: "solidcraft/"' in formats,
                "rebranding must preserve the serialized solidcraft/ design format")
        io = read("crates/io/src/lib.rs")
        legacy = re.search(r"pub const LEGACY_DESIGN_EXTS:[^\r\n]+", io)
        require(legacy is not None and '"solidcraft"' in legacy[0] and '"solvecraft"' in legacy[0],
                "legacy design extensions must remain readable")
        for path, marker in (
            ("crates/ui-egui/src/settings_profiles.rs", "solidcraft-profile/1"),
            ("crates/ui-egui/src/toolbar_custom.rs", "solidcraft-shortcuts/1"),
            ("crates/io/src/design.rs", "solidcraft-preview/1"),
            ("crates/io/src/design/thumbnail.rs", "solidcraft-thumbnail/1"),
            ("crates/io/src/design/native_cache.rs", "solidcraft-model-cache/9"),
        ):
            require(f'"{marker}"' in read(path), f"persisted format changed: {marker}")
        require("Copyright (c) 2026 SolidCraft contributors" in read("LICENSE-MIT"),
                "original upstream copyright notice must remain intact")
        # Preserve the mixed-license source revision exactly; a product rename does not
        # rewrite the upstream interface license or the scope of separate permission.
        for name in ("LICENSE-BRAND", "crates/look/LICENSE", "crates/ui-kit/LICENSE", "crates/theme/LICENSE"):
            digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
            require(digest == "3cabf11ab54508ee3c5a0c2573239a2e34eee715d1802c229188a33bc92dda11",
                    f"upstream interface license changed or removed: {name}")

        for size in (16, 32, 256, 512):
            require((root / f"assets/icons/app/linux/exports/hicolor/{size}x{size}/apps/{APP_ID}.png").is_file(),
                    f"missing MantelCAD icon export: {size}px")
        for name in ("mantelcad-mark.svg", "mantelcad-wordmark.svg", "mantelcad-lockup-horizontal.svg"):
            require((root / "assets/branding/logo" / name).is_file(), f"missing editable brand artifact: {name}")
        require((root / "solidcore/LICENSE").is_file(), "included kernel license is missing")
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors.append(f"cannot validate branding inputs: {error}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    errors = validate(args.root)
    for error in errors:
        print(f"branding: {error}", file=sys.stderr)
    if errors:
        return 1
    print("MantelCAD identity, update ownership, artifacts and compatibility markers verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
