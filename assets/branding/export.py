#!/usr/bin/env python3
"""Export MantelCAD brand assets from the Rust mark and bundled IBM Plex font.

Run from the repository with Python 3.11+, Pillow, fontTools and rustc on PATH.
This regenerates SVG, PNG and ICO exports. Compile the macOS Composer project
separately with actool as documented in README.md.
"""
from pathlib import Path
import json
import re
import subprocess
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "assets/branding"
APP = ROOT / "assets/icons/app"
STAGE = ROOT / "target/resources/mantelcad-brand"
STAGE.mkdir(parents=True, exist_ok=True)
MASTER = APP / "shared/source/app_icon.rs"
FONT = ROOT / "crates/look/fonts/ibm-plex-sans/IBMPlexSans-Variable.ttf"
NAVY = "#153747"

def mark_body(mono=None):
    source = MASTER.read_text()
    faces = re.findall(r"Face\s*\{\s*outline: &\[(.*?)\],\s*from: \(\((.*?)\), \[(.*?)\]\),\s*to: \(\((.*?)\), \[(.*?)\]\),\s*\}", source, re.S)
    if len(faces) != 3:
        raise ValueError("Expected three faces in app_icon.rs")
    defs, paths = [], []
    for index, (outline, a, ca, b, cb) in enumerate(faces):
        points = re.findall(r"\(([0-9.]+), ([0-9.]+)\)", outline)
        d = "M" + "L".join(f"{float(x):g} {float(y):g}" for x, y in points) + "Z"
        colors = ["#" + "".join(f"{int(v):02x}" for v in c.split(",")) for c in (ca, cb)]
        xy = [float(v) for v in (a + "," + b).split(",")]
        defs.append(f'<linearGradient id="m{index}" gradientUnits="userSpaceOnUse" x1="{xy[0]}" y1="{xy[1]}" x2="{xy[2]}" y2="{xy[3]}"><stop stop-color="{colors[0]}"/><stop offset="1" stop-color="{colors[1]}"/></linearGradient>')
        paths.append(f'<path d="{d}" fill="{mono or f"url(#m{index})"}"/>')
    return ("" if mono else "<defs>" + "".join(defs) + "</defs>") + "".join(paths)

def svg(body, box, title="MantelCAD"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img"><title>{title}</title>{body}</svg>\n'

def wordmark():
    font = instantiateVariableFont(TTFont(FONT), {"wght": 600, "wdth": 100})
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    paths, x = [], 0
    for character in "MantelCAD":
        name = cmap[ord(character)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 780)))
        paths.append(f'<path d="{pen.getCommands()}"/>')
        x += glyphs[name].width
    return f'<g fill="{NAVY}">' + "".join(paths) + "</g>", x

def export():
    shim = f'''#[path = "{MASTER}"] mod app_icon;
#[path = "{APP / 'shared/source/windows_ico.rs'}"] mod windows_ico;
fn main() -> Result<(), Box<dyn std::error::Error>> {{
    let root = std::path::Path::new("{STAGE}");
    for size in [16,20,24,32,40,48,64,128,256,512,1024,2048] {{
        std::fs::write(root.join(format!("{{size}}.rgba")), app_icon::rgba(size)?)?;
    }}
    std::fs::write(root.join("mantelcad-executable.ico"), windows_ico::encode()?)?;
    Ok(())
}}
'''
    (STAGE / "export.rs").write_text(shim)
    subprocess.run(["rustc", "--edition=2024", "-O", str(STAGE / "export.rs"), "-o", str(STAGE / "export")], check=True)
    subprocess.run([str(STAGE / "export")], check=True)
    images = {}
    for size in [16,20,24,32,40,48,64,128,256,512,1024,2048]:
        images[size] = Image.frombytes("RGBA", (size, size), (STAGE / f"{size}.rgba").read_bytes())
    for size in [16,24,32,48,64,128,256,512]:
        dest = APP / f"linux/exports/hicolor/{size}x{size}/apps/com.ichen27.mantelcad.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        images[size].save(dest)
    for size in [512,1024,2048]:
        images[size].save(BRAND / f"logo/mantelcad-mark-{size}.png")
    images[256].save(APP / "windows/exports/mantelcad.ico", sizes=[(s,s) for s in [16,20,24,32,40,48,64,128,256]], append_images=[images[s] for s in [16,20,24,32,40,48,64,128]])
    (APP / "windows/exports/mantelcad-executable.ico").write_bytes((STAGE / "mantelcad-executable.ico").read_bytes())
    body = mark_body()
    (BRAND / "logo/mantelcad-mark.svg").write_text(svg(body, "0 0 1024 1024"))
    for color, name in [("#000000","black"),("#ffffff","white")]:
        (BRAND / f"logo/mantelcad-mark-mono-{name}.svg").write_text(svg(mark_body(color), "0 0 1024 1024"))
    word, width = wordmark()
    (BRAND / "logo/mantelcad-wordmark.svg").write_text(svg(word, f"0 0 {width} 1000"))
    lockup = svg(body + f'<g transform="translate(1030 80) scale(.85)">{word}</g>', f"0 0 {1030+width*.85:g} 1024")
    (BRAND / "logo/mantelcad-lockup-horizontal.svg").write_text(lockup)
    (ROOT / "assets/styles/web/loading-logo.svg").write_text(lockup)
    (APP / "macos/source/MantelCAD.icon/Assets/03-solid-blue-cutout.svg").write_text(svg(body, "0 0 1024 1024"))
    composer = APP / "macos/source/MantelCAD.icon/icon.json"
    data = json.loads(composer.read_text())
    data["groups"][0]["name"] = "MantelCAD M"
    data["groups"][0]["layers"][0]["name"] = "MantelCAD M"
    composer.write_text(json.dumps(data, indent=2) + "\n")

    card = Image.new("RGB", (1280,640), "#edf3f3")
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((55,55,1225,585), radius=30, fill="#ffffff")
    draw.line((95,505,1185,505), fill="#c9dfdc", width=2)
    card.paste(images[256], (75,145), images[256])
    font = ImageFont.truetype(str(FONT), 108)
    font.set_variation_by_axes([600,100])
    draw.text((340,202), "MantelCAD", font=font, fill=NAVY)
    sub = ImageFont.truetype(str(FONT), 34)
    draw.text((345,335), "Sketch. Constrain. Build.", font=sub, fill="#547178")
    small = ImageFont.truetype(str(FONT), 24)
    draw.text((95,535), "PARAMETRIC 3D CAD", font=small, fill="#108c88")
    card.save(BRAND / "web/source/og.png")
    card.save(STAGE / "brand-preview.png")
    print("Exported MantelCAD SVG, PNG, ICO, loading and social assets.")

if __name__ == "__main__":
    export()
