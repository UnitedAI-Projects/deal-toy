"""Runs only inside a fresh job container. Source is untrusted Python, not a DSL."""
import importlib.util
import json
import resource
import sys
from pathlib import Path

import build123d as bd

MAX_ARTIFACT_BYTES = 15 * 1024 * 1024

def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (50, 50))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_ARTIFACT_BYTES, MAX_ARTIFACT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    # Linux container memory is additionally bounded by the instance size.
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
        resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))



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
    facts = {"units": "mm", "bounds": list(bounds), "volume_mm3": shape.volume,
             "solids": len(shape.solids()), "valid": True,
             "manufacturing_approval": "not_reviewed"}
    (destination / "facts.json").write_text(json.dumps(facts))
    return facts


if __name__ == "__main__":
    limits()
    build(Path(sys.argv[1]), Path(sys.argv[2]))
