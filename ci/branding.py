"""Audit shipped identity while allowing upstream license and format provenance."""
from pathlib import Path
import re
import tomllib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]

def check():
    failures = []
    for folder in ("apps", "crates", "packaging"):
        for p in (ROOT / folder).rglob("*"):
            if not p.is_file() or p.suffix not in (".rs", ".tsv", ".html", ".plist", ".in", ".wxs", ".wxl"):
                continue
            text = p.read_text()
            for i, line in enumerate(text.splitlines(), 1):
                if "copyright" in line.lower() or line.lstrip().startswith(("//", "#")):
                    continue
                if any(mark in line for mark in ("VectorCraft", "ai.storyteller.vectorcraft", "getartcraft.com", "discord.gg/artcraft")):
                    failures.append(f"{p.relative_to(ROOT)}:{i}: upstream display identity")
    for app in ("", "-cli", "-web"):
        data = tomllib.loads((ROOT / f"apps/vectorcraft{app}/Cargo.toml").read_text())
        if data["package"]["name"] != f"mantelart{app}":
            failures.append(f"incorrect application package name: {app}")
    for p in (ROOT / "crates/ui-egui/src/i18n").glob("*.tsv"):
        seen = set()
        for line in p.read_text().splitlines():
            cols = line.split("\t")
            if len(cols) < 3 or line.startswith("#"):
                continue
            key = tuple(cols[:2])
            if key in seen:
                failures.append(f"{p.name}: duplicate translation key {key}")
            seen.add(key)
    html = (ROOT / "apps/vectorcraft-web/index.html").read_text()
    if "<title>MantelArt</title>" not in html:
        failures.append("web page title")
    plist = (ROOT / "packaging/macos/Info.plist.in").read_text()
    if "<string>com.ichen27.mantelart</string>" not in plist:
        failures.append("macOS bundle identifier")
    if "<array><string>vectorcraft</string><string>drawcraft</string></array>" not in plist:
        failures.append("legacy native file associations lost")
    for p in (ROOT / "packaging").rglob("*"):
        if p.suffix in (".xml", ".wxs", ".wxl", ".wxi") or p.name.endswith(".xml.in"):
            ET.parse(p)
    if list((ROOT / "docs/brand").glob("artcraft-*.svg")):
        failures.append("restricted upstream logos remain")
    assert not failures, "\n".join(failures)

if __name__ == "__main__":
    check()
    print("MantelArt identity audit passed")
