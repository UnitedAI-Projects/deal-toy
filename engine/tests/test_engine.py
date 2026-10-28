import json
import sys
from pathlib import Path

import build123d as bd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runner import build
from service import execute


def test_real_geometry_and_export_round_trip(tmp_path):
    source = Path(__file__).resolve().parents[2] / "examples/bridge.py"
    facts = build(source, tmp_path)
    reopened = bd.import_step(tmp_path / "model.step")
    assert reopened.is_valid
    assert list(reopened.bounding_box().size) == pytest.approx([100, 55, 51])
    assert reopened.volume == pytest.approx(facts["volume_mm3"])
    assert (tmp_path / "model.glb").read_bytes()[:4] == b"glTF"
    assert (tmp_path / "model.stl").stat().st_size > 84
    assert json.loads((tmp_path / "facts.json").read_text())["manufacturing_approval"] == "not_reviewed"


def test_isolated_child_reports_invalid_model():
    with pytest.raises(ValueError, match="valid solid"):
        execute("def build():\n    return 'not geometry'\n")


def test_timeout_terminates_child():
    with pytest.raises(ValueError, match="time limit"):
        execute("while True: pass", timeout=0.1)


def test_source_limit():
    with pytest.raises(ValueError, match="100 KB"):
        execute("x" * 100001)


def test_service_exports_all_formats():
    result = execute("import build123d as bd\ndef build():\n    return bd.Box(10, 20, 30)\n")
    assert {a["name"] for a in result["artifacts"]} == {"model.step", "model.stl", "model.glb", "facts.json"}
