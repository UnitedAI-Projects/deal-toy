"""Runs only inside a fresh job container. Source is untrusted Python, not a DSL."""
import importlib.util
import json
import math
import re
import resource
import sys
from pathlib import Path

import build123d as bd
from OCP.OSD import OSD_Parallel, OSD_ThreadPool

MAX_ARTIFACT_BYTES = 15 * 1024 * 1024

def limits():
    # OCCT's parallel exporters can deadlock when Linux refuses new threads
    # under RLIMIT_NPROC. Use a single OCCT thread without relaxing job limits.
    OSD_Parallel.SetUseOcctThreads_s(True)
    OSD_ThreadPool.DefaultPool_s(1).Init(1)
    resource.setrlimit(resource.RLIMIT_CPU, (50, 50))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_ARTIFACT_BYTES, MAX_ARTIFACT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    # Linux container memory is additionally bounded by the instance size.
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
        resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))



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


def labelled_parts(shape) -> list:
    """Top-level parts and their labels; GLB node names carry the same labels."""
    children = list(getattr(shape, "children", None) or []) or [shape]
    return [{"label": (child.label or "")[:120], "volume_mm3": float(child.volume)}
            for child in children[:500]]


def build(source: Path, destination: Path) -> dict:
    spec = importlib.util.spec_from_file_location("user_model", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    shape = module.build()
    if not isinstance(shape, bd.Shape) or not shape.is_valid or not shape.solids():
        raise ValueError("build() must return a valid solid build123d Shape")
    if shape.volume <= 0:
        raise ValueError("Model has no positive solid volume")
    bounds = shape.bounding_box().size
    if max(bounds) > 2000:
        raise ValueError("Model exceeds the 2000 mm workspace limit")
    destination.mkdir(exist_ok=True)
    if not bd.export_step(shape, destination / "model.step"):
        raise ValueError("STEP export failed")
    if not bd.export_stl(shape, destination / "model.stl", tolerance=0.05):
        raise ValueError("STL export failed")
    bd.export_gltf(shape, destination / "model.glb", binary=True)
    # volume_mm3 sums part volumes, so overlapping parts count twice; it is not a
    # manufacturing volume.
    facts = {"units": "mm", "bounds": list(bounds), "volume_mm3": shape.volume,
             "solids": len(shape.solids()), "valid": True,
             "manufacturing_approval": "not_reviewed",
             "parts": labelled_parts(shape)}
    params = declared_params(module)
    if params is not None:
        facts["params"] = params
    (destination / "facts.json").write_text(json.dumps(facts))
    return facts


if __name__ == "__main__":
    limits()
    build(Path(sys.argv[1]), Path(sys.argv[2]))
