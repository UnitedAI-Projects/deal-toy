import base64
import json
import sys
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ENGINE), str(ENGINE / "lib")]
import build123d as bd
from mantel.inspect import inspect_record
from runner import build
from service import execute_measure

ROOT = ENGINE.parent
BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)


def step_of(tmp_path, shape):
    path = tmp_path / "model.step"
    assert bd.export_step(shape, path, write_pcurves=False)
    return base64.b64encode(path.read_bytes()).decode()


def pin_and_wall():
    wall = bd.Box(2, 40, 20, align=BOTTOM)
    wall.label = "Wall"
    pin = bd.Pos(11, 0, 0) * bd.Cylinder(2, 20, align=BOTTOM)  # axis 10 mm from the wall's +X face
    pin.label = "Pin"
    return bd.Compound(children=[wall, pin])


def test_measure_cylinder_to_plane(tmp_path):
    shape = pin_and_wall()
    record = inspect_record(shape, None)
    plane = next(f["index"] for f in record["faces"] if f["part"] == 0 and f["type"] == "plane"
                 and f["plane"]["normal"] == pytest.approx([1, 0, 0]))
    cylinder = next(f["index"] for f in record["faces"] if f["part"] == 1 and f["type"] == "cylinder")
    (result,) = execute_measure(step_of(tmp_path, shape), [
        {"key": "f", "a": {"face": plane}, "b": {"face": cylinder}}])["results"]
    assert result["key"] == "f"
    assert result["distance"] == pytest.approx(8, abs=1e-6)
    assert len(result["points"]) == 2
    (parts,) = execute_measure(step_of(tmp_path, shape), [
        {"key": "p", "a": {"part": 0}, "b": {"part": 1}}])["results"]
    assert parts["distance"] == pytest.approx(8, abs=1e-6)


def test_measure_matches_record_indices(tmp_path):
    build(ROOT / "examples/enclosure_inspect.py", tmp_path)
    record = json.loads((tmp_path / "inspect.json").read_text())
    lip = next(d for d in record["dimensions"] if d["name"] == "Lip clearance")
    a, b = lip["faces"]
    step = base64.b64encode((tmp_path / "model.step").read_bytes()).decode()
    (result,) = execute_measure(step, [{"key": "lip", "a": {"face": a}, "b": {"face": b}}])["results"]
    assert result["distance"] == pytest.approx(0.3, abs=1e-6)


def test_measure_rejects_bad_index(tmp_path):
    (result,) = execute_measure(step_of(tmp_path, pin_and_wall()), [
        {"key": "x", "a": {"face": 9999}, "b": {"part": 0}}])["results"]
    assert result == {"key": "x", "error": "No face 9999 in this build"}


@pytest.mark.parametrize("requests, message", [
    ([], "1 to 50"),
    ([{"key": "k", "a": {"face": 1}}], "a and b"),
    ([{"key": "k", "a": {"face": -1}, "b": {"part": 0}}], "a and b"),
    ([{"key": "k", "a": {"face": 1, "part": 0}, "b": {"part": 0}}], "a and b"),
])
def test_measure_rejects_malformed_requests(tmp_path, requests, message):
    with pytest.raises(ValueError, match=message):
        execute_measure(step_of(tmp_path, pin_and_wall()), requests)


def test_measure_rejects_unreadable_step():
    with pytest.raises(ValueError, match="STEP"):
        execute_measure(base64.b64encode(b"not a step file").decode(), [{"key": "k", "a": {"part": 0}, "b": {"part": 0}}])


def test_measure_runs_no_model_code(tmp_path):
    # The STEP is the only input: no Python source travels with a measure request.
    import inspect

    import service
    assert "source" not in inspect.signature(service.execute_measure).parameters
    assert "runner.py" not in inspect.getsource(service.execute_measure)


def test_service_measure_endpoint(tmp_path, monkeypatch):
    import threading
    import urllib.request

    import service

    monkeypatch.setattr(service.Handler, "used", False)
    body = json.dumps({"step": step_of(tmp_path, pin_and_wall()),
                       "requests": [{"key": "p", "a": {"part": 0}, "b": {"part": 1}}]}).encode()
    with service.HTTPServer(("127.0.0.1", 0), service.Handler) as server:
        thread = threading.Thread(target=server.handle_request, daemon=True)
        thread.start()
        request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/measure", data=body,
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            reply = json.loads(response.read())
        thread.join(timeout=5)
    assert reply["results"][0]["distance"] == pytest.approx(8, abs=1e-6)
