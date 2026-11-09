"""Exact distances on a build's persisted STEP. Runs in the job container; it imports no model code.

Faces and parts are addressed by inspection-record index: faces in `part.faces()` order, counted
across parts, which the engine tests pin to be stable across a STEP round trip.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).with_name("lib")))
import build123d as bd
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from runner import limits


def _target(target, parts, faces):
    if "face" in target:
        if target["face"] >= len(faces):
            raise LookupError(f"No face {target['face']} in this build")
        return faces[target["face"]]
    if target["part"] >= len(parts):
        raise LookupError(f"No part {target['part']} in this build")
    return parts[target["part"]]


def measure(step: Path, requests: list) -> list:
    shape = bd.import_step(step)
    parts = list(getattr(shape, "children", None) or []) or [shape]
    faces = [f for p in parts for f in p.faces()]
    results = []
    for request in requests:
        try:
            a = _target(request["a"], parts, faces)
            b = _target(request["b"], parts, faces)
        except LookupError as error:
            results.append({"key": request["key"], "error": str(error)})
            continue
        extrema = BRepExtrema_DistShapeShape(a.wrapped, b.wrapped)
        if not extrema.IsDone() or extrema.NbSolution() < 1:
            results.append({"key": request["key"], "error": "The distance could not be computed"})
            continue
        p, q = bd.Vector(extrema.PointOnShape1(1)), bd.Vector(extrema.PointOnShape2(1))
        results.append({"key": request["key"], "distance": round(extrema.Value(), 6),
                        "points": [[round(v, 6) for v in (p.X, p.Y, p.Z)], [round(v, 6) for v in (q.X, q.Y, q.Z)]]})
    return results


if __name__ == "__main__":
    limits()
    step, requests, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(exist_ok=True)
    (out / "measure.json").write_text(json.dumps({"results": measure(step, json.loads(requests.read_text()))}))
