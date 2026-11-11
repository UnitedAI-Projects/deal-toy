"""Runs only inside a fresh job container. Source is untrusted Python, not a DSL."""
import importlib.util
import json
import math
import re
import resource
import sys
from pathlib import Path

import build123d as bd
from OCP.Font import Font_FontAspect, Font_FontMgr, Font_StrictLevel
from OCP.OSD import OSD_Parallel, OSD_ThreadPool
from OCP.TCollection import TCollection_AsciiString

# The mantel step library ships beside the runner; -I keeps the script's own directory off the path.
sys.path.insert(0, str(Path(__file__).with_name("lib")))
import mantel
from mantel.inspect import inspect_record
from mantel.model import last_model

MAX_ARTIFACT_BYTES = 15 * 1024 * 1024
MESH_TOLERANCE = 0.05

def limits():
    # OCCT's parallel exporters can deadlock when Linux refuses new threads
    # under RLIMIT_NPROC. Use a single OCCT thread without relaxing job limits.
    OSD_Parallel.SetUseOcctThreads_s(True)
    OSD_ThreadPool.DefaultPool_s(1).Init(1)
    resource.setrlimit(resource.RLIMIT_CPU, (780, 780))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_ARTIFACT_BYTES, MAX_ARTIFACT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    # Linux container memory is additionally bounded by the instance size.
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
        resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))



# Metric-compatible free fonts for the names scripts usually ask for; build123d's Text defaults to
# Arial. The container image installs these (fonts-liberation).
FONT_SUBSTITUTES = {
    "Arial": "Liberation Sans",
    "Helvetica": "Liberation Sans",
    "Times New Roman": "Liberation Serif",
    "Courier New": "Liberation Mono",
}


def fonts():
    """Map missing common fonts to their Liberation equivalents. Without this, OCCT falls back to a
    single-line stroke font on Linux, which looks wrong and is slow to turn into solid text."""
    manager = Font_FontMgr.GetInstance_s()
    manager.InitFontDataBase()

    def has(name):
        return manager.FindFont(
            TCollection_AsciiString(name),
            Font_StrictLevel.Font_StrictLevel_Strict,
            Font_FontAspect.Font_FontAspect_Regular,
            False,
        ) is not None

    for name, free in FONT_SUBSTITUTES.items():
        if not has(name) and has(free):
            # OCCT ships its own aliases for these names; replace them rather than add to them.
            manager.RemoveFontAlias(TCollection_AsciiString(name.lower()), TCollection_AsciiString(""))
            manager.AddFontAlias(TCollection_AsciiString(name.lower()), TCollection_AsciiString(free.lower()))


PARAM_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


def number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def declared_params(module) -> dict | None:
    """Editable dimensions the script declares in PARAMS; unknown keys are dropped."""
    params = getattr(module, "PARAMS", None)
    if params is None:
        return None
    if not isinstance(params, dict) or len(params) > 100:
        raise ValueError("PARAMS must be a dict of at most 100 entries")
    result = {}
    for name, spec in params.items():
        if not isinstance(name, str) or not PARAM_NAME.match(name):
            raise ValueError(f"PARAMS name {name!r} must be a Python identifier")
        if not isinstance(spec, dict) or not number(spec.get("value")):
            raise ValueError(f"PARAMS[{name!r}] needs a numeric 'value'")
        entry = {"value": float(spec["value"])}
        for key, limit in (("unit", 16), ("part", 120)):
            if isinstance(spec.get(key), str):
                entry[key] = spec[key][:limit]
        for key in ("min", "max"):
            if number(spec.get(key)):
                entry[key] = float(spec[key])
        result[name] = entry
    return result


def labelled_parts(shape, appearance=None) -> list:
    """Top-level parts and their labels; GLB node names carry the same labels.

    appearance maps a part label to the ((r, g, b), finish) an appearance step gave it.
    """
    children = list(getattr(shape, "children", None) or []) or [shape]
    parts = []
    for child in children[:500]:
        entry = {"label": (child.label or "")[:120], "volume_mm3": float(child.volume)}
        if appearance and child.label in appearance:
            color, finish = appearance[child.label]
            entry["color"], entry["finish"] = [round(c, 4) for c in color], finish
        parts.append(entry)
    return parts


def build(source: Path, destination: Path, stop_after: int | None = None, preview: bool = False,
          modules: Path | None = None, check: str | None = None) -> dict:
    """Builds and exports the model.

    stop_after runs only the first N steps; preview skips STEP/STL; modules is a directory of saved
    actions (`<id>@<version>.py`); check runs that saved action's example after the model's steps.
    """
    spec = importlib.util.spec_from_file_location("user_model", source)
    module = importlib.util.module_from_spec(spec)
    mantel.reset_log()
    mantel.set_stop_after(stop_after)
    mantel.reset_saved()
    if modules is not None:
        mantel.load_saved(modules)
    mantel.set_check(check)
    spec.loader.exec_module(module)
    shape = module.build()
    if not isinstance(shape, bd.Shape) or not shape.is_valid or not shape.solids():
        raise ValueError("build() must return a valid solid build123d Shape")
    facts = export(shape, destination, preview=preview, module=module,
                   looks=getattr(last_model(), "looks", None))
    params = declared_params(module)
    if params is not None:
        facts["params"] = params
    steps = mantel.last_log()
    if steps is not None:
        facts["steps"] = steps
        facts["incomplete"] = any(s["state"] in ("failed", "blocked") for s in steps)
        if stop_after is not None:
            facts["stoppedAfter"] = stop_after
    if check is not None:
        facts["check"] = mantel.last_check() or {"key": check, "error": "The model did not reach m.result()"}
    (destination / "facts.json").write_text(json.dumps(facts))
    return facts


# A MantelCAD parameter Mantel can show and change: a plain number with an optional unit.
DESIGN_EXPR = re.compile(r"^\s*(-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?)\s*([A-Za-z]{0,8})\s*$")


def design_params(design: dict) -> dict | None:
    """The design's own named parameters (not the dimensions its features made) with literal values."""
    params = design.get("params")
    if not isinstance(params, list):
        return None
    result = {}
    for spec in params[:100]:
        if not isinstance(spec, dict) or spec.get("model") is not False:
            continue
        name, expr = spec.get("name"), spec.get("expr")
        if not isinstance(name, str) or not PARAM_NAME.match(name) or not isinstance(expr, str):
            continue
        match = DESIGN_EXPR.match(expr)
        if not match:
            continue
        value = float(match.group(1))
        if not math.isfinite(value):
            continue
        entry = {"value": value}
        unit = match.group(2) or (spec.get("unit") if isinstance(spec.get("unit"), str) else "")
        if unit:
            entry["unit"] = unit[:16]
        result[name] = entry
    return result or None


STEP_ENTITY = re.compile(r"#(\d+)\s*=\s*([A-Z_0-9]+)\s*\((.*?)\)\s*;", re.DOTALL)
STEP_REF = re.compile(r"#(\d+)")
STEP_NAME = re.compile(r"\s*'((?:[^']|'')*)'")


def step_colours(text: str) -> dict:
    """The colour MantelCAD styled each named solid with: {body name: (r, g, b)}.

    STYLED_ITEM('color', (style), #item) leads through the presentation style to a COLOUR_RGB;
    the item is a MANIFOLD_SOLID_BREP('name', ...).
    """
    entities = {int(n): (kind, body) for n, kind, body in STEP_ENTITY.findall(text)}
    colours = {}
    for kind, body in entities.values():
        if kind != "STYLED_ITEM":
            continue
        refs = [int(r) for r in STEP_REF.findall(body)]
        if len(refs) < 2:
            continue
        item, queue, seen = refs[-1], refs[:-1], set()
        while queue:
            ref = queue.pop(0)
            if ref in seen or ref not in entities:
                continue
            seen.add(ref)
            entity_kind, entity_body = entities[ref]
            if entity_kind == "COLOUR_RGB":
                values = [float(v) for v in entity_body.split(",")[1:4]]
                target = entities.get(item)
                quoted = STEP_NAME.match(target[1]) if target and target[0] == "MANIFOLD_SOLID_BREP" else None
                if quoted:
                    name = quoted.group(1).replace("''", "'")
                    colours.setdefault(name, tuple(min(1.0, max(0.0, v)) for v in values))
                break
            queue.extend(int(r) for r in STEP_REF.findall(entity_body))
    return colours


def read_bodies(step: Path):
    """The STEP file's solids as parts labelled with their body names, and their colours.

    MantelCAD names and colours each body on its solid (MANIFOLD_SOLID_BREP), not on a product, so
    the labels and colours come from the entity each solid was read from.
    """
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer

    reader = STEPControl_Reader()
    if reader.ReadFile(str(step)) != IFSelect_RetDone:
        raise ValueError("MantelCAD's STEP export could not be read")
    reader.TransferRoots()
    transfer = reader.WS().TransferReader()
    colours = step_colours(step.read_text(errors="replace"))
    explorer = TopExp_Explorer(reader.OneShape(), TopAbs_SOLID)
    # A body with separate pieces (a line of lettering) is several solids with one name: one part.
    bodies: dict[str, list] = {}
    colour_of: dict[str, tuple] = {}
    count = 0
    while explorer.More() and count < 5000:
        solid = bd.Solid(explorer.Current())
        entity = transfer.EntityFromShapeResult(explorer.Current(), 1)
        name = entity.Name().ToCString() if entity is not None and hasattr(entity, "Name") else ""
        label = name[:120] or f"Body{len(bodies) + 1}"
        colour = colours.get(name)
        if colour is not None:
            solid.color = bd.Color(*colour)
            colour_of.setdefault(label, colour)
        bodies.setdefault(label, []).append(solid)
        count += 1
        explorer.Next()
    parts, looks = [], {}
    for label, solids in list(bodies.items())[:500]:
        part = solids[0] if len(solids) == 1 else bd.Compound(children=solids)
        part.label = label
        if label in colour_of:
            part.color = bd.Color(*colour_of[label])
            looks[label] = (colour_of[label], "satin")
        parts.append(part)
    if not parts:
        raise ValueError("The design produced no solid body")
    return (parts[0] if len(parts) == 1 else bd.Compound(children=parts)), looks


def build_from_step(step: Path, destination: Path, design: Path | None = None) -> dict:
    """Exports a model another engine (MantelCAD) built and wrote as STEP; Mantel runs no model code."""
    shape, looks = read_bodies(step)
    if not shape.is_valid:
        raise ValueError("The design's STEP export is not a valid solid")
    facts = export(shape, destination, write_step=False, looks=looks)
    if design is not None:
        params = design_params(json.loads(design.read_text()))
        if params is not None:
            facts["params"] = params
    (destination / "facts.json").write_text(json.dumps(facts))
    return facts


def export(shape, destination: Path, preview: bool = False, module=None, looks=None,
           write_step: bool = True) -> dict:
    """Writes the exports of a built shape and returns its facts; the caller writes facts.json."""
    if shape.volume <= 0:
        raise ValueError("Model has no positive solid volume")
    bounds = shape.bounding_box().size
    if max(bounds) > 2000:
        raise ValueError("Model exceeds the 2000 mm workspace limit")
    destination.mkdir(exist_ok=True)
    # STEP readers rebuild surface curves (pcurves) from the 3D geometry; writing them
    # roughly doubles the file and its export time.
    if not preview:
        if write_step and not bd.export_step(shape, destination / "model.step", write_pcurves=False):
            raise ValueError("STEP export failed")
        if not bd.export_stl(shape, destination / "model.stl", tolerance=MESH_TOLERANCE):
            raise ValueError("STL export failed")
    # The viewer mesh uses the STL tolerances rather than build123d's much finer default.
    bd.export_gltf(shape, destination / "model.glb", binary=True,
                   linear_deflection=MESH_TOLERANCE, angular_deflection=0.1)
    # volume_mm3 sums part volumes, so overlapping parts count twice; it is not a
    # manufacturing volume.
    facts = {"units": "mm", "bounds": list(bounds), "volume_mm3": shape.volume,
             "solids": len(shape.solids()), "valid": True,
             "manufacturing_approval": "not_reviewed",
             "parts": labelled_parts(shape, looks)}
    if not preview:
        # Exact measurements for picking and checks; a failure here never fails the build.
        try:
            record = inspect_record(shape, module)
        except Exception as error:  # noqa: BLE001
            record = {"version": 1, "units": "mm", "parts": [], "faces": [], "holes": [], "faces_truncated": True,
                      "warnings": [f"Inspection failed: {type(error).__name__}: {error}"[:300]]}
        (destination / "inspect.json").write_text(json.dumps(record))
    return facts


if __name__ == "__main__":
    limits()
    fonts()
    options = sys.argv[3:]

    def option(flag):
        return options[options.index(flag) + 1] if flag in options else None

    if "--step" in options:
        # argv[1] is the STEP file MantelCAD wrote beside the output directory; the design gives the parameters.
        design = option("--design")
        build_from_step(Path(sys.argv[1]), Path(sys.argv[2]), Path(design) if design else None)
        sys.exit(0)
    stop = option("--stop-after")
    modules = option("--modules")
    build(Path(sys.argv[1]), Path(sys.argv[2]), stop_after=int(stop) if stop else None,
          preview="--preview" in options, modules=Path(modules) if modules else None, check=option("--check"))
