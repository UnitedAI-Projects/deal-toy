#!/usr/bin/env python3
"""Package a locally built macOS development preview, including its licenses.

Run cargo build --locked -p mantelart -p mantelart-cli first.
This produces an ad-hoc-signed preview, not a notarized release.
"""
from pathlib import Path
import os
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]

def main():
    if sys.platform != "darwin":
        raise SystemExit("This preview packager requires macOS.")
    os.chdir(ROOT)
    target = Path(os.environ.get("CARGO_TARGET_DIR", "target"))
    base = ROOT / "work/preview"
    app = base / "MantelArt.app/Contents"
    (app / "MacOS").mkdir(parents=True, exist_ok=True)
    (app / "Resources").mkdir(exist_ok=True)
    for source, name in (("mantelart", "MantelArt"), ("mantelart-cli", "mantelart-cli")):
        binary = target / "debug" / source
        if not binary.is_file():
            raise SystemExit(f"Build {source} first: cargo build --locked -p {source}")
        shutil.copy2(binary, app / "MacOS" / name)
        subprocess.run(["strip", "-S", "-x", str(app / "MacOS" / name)], check=True)
    shutil.copy2("assets/app-icon/mantelart.icns", app / "Resources/MantelArt.icns")
    for name in ("LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "ASSETS.md", "ATTRIBUTION.md"):
        shutil.copy2(name, app / "Resources" / name)
    shutil.copytree("licenses", app / "Resources/licenses", dirs_exist_ok=True)
    for p in Path("assets/fonts").glob("OFL-*.txt"):
        shutil.copy2(p, app / "Resources/licenses" / p.name)
    shutil.copy2("assets/icons/LICENSE-lucide.txt", app / "Resources/licenses/LICENSE-lucide.txt")
    shutil.copy2("assets/app-icon/LICENSE.txt", app / "Resources/Icon-LICENSE.txt")
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    import tomllib
    version = tomllib.loads(Path("Cargo.toml").read_text())["workspace"]["package"]["version"]
    text = Path("packaging/macos/Info.plist.in").read_text()
    text = text.replace("@VERSION@", version).replace("@SHORT_VERSION@", version.split("-")[0]).replace("@BUILD_SHA@", sha)
    (app / "Info.plist").write_text(text)
    (app / "Resources/BUILD-INFO.txt").write_text(f"MantelArt development preview\nSource revision: {sha}\nProfile: dev\nArchitecture: {platform.machine()}\nAd-hoc signed; not notarized.\n")
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app.parent)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app.parent)], check=True)
    Path("artifacts").mkdir(exist_ok=True)
    archive = Path(f"artifacts/MantelArt-preview-macos-{platform.machine()}.zip")
    if archive.exists():
        archive.unlink()
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app.parent), str(archive)], check=True)
    print(f"{archive}: {archive.stat().st_size} bytes")

if __name__ == "__main__":
    main()
