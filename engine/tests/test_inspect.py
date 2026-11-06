import json
import sys
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ENGINE), str(ENGINE / "lib")]
import build123d as bd
from mantel.inspect import inspect_record
from runner import build

ROOT = ENGINE.parent
BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)


def labelled(shape, label):
    shape.label = label
    return shape


def compound(*parts):
    return bd.Compound(children=list(parts))


def faces_of(record, kind):
    return [f for f in record["faces"] if f["type"] == kind]


def test_block_faces_are_exact():
    record = inspect_record(compound(labelled(bd.Box(40, 20, 30, align=BOTTOM), "Block")), None)
    assert [p["label"] for p in record["parts"]] == ["Block"]
    assert record["parts"][0]["volume"] == pytest.approx(24000)
    planes = faces_of(record, "plane")
    assert len(planes) == 6
    top = next(f for f in planes if f["plane"]["normal"] == pytest.approx([0, 0, 1]))
    left = next(f for f in planes if f["plane"]["normal"] == pytest.approx([-1, 0, 0]))
    assert top["area"] == pytest.approx(800, abs=1e-6)
    assert top["thickness"] == pytest.approx(30, abs=1e-6)
    assert left["thickness"] == pytest.approx(40, abs=1e-6)
    assert record["warnings"] == [] and record["faces_truncated"] is False


def test_holes_and_bosses():
    plate = bd.Box(60, 30, 10, align=BOTTOM)
    plate = plate - bd.Pos(-15, 0, -1) * bd.Cylinder(2.5, 12, align=BOTTOM)
    plate = plate - bd.Pos(15, 0, 4) * bd.Cylinder(2, 6, align=BOTTOM)
    plate = plate + bd.Pos(0, 0, 10) * bd.Cylinder(4, 5, align=BOTTOM)
    record = inspect_record(compound(labelled(plate, "Plate")), None)
    holes = sorted(record["holes"], key=lambda h: h["diameter"])
    assert [round(h["diameter"], 6) for h in holes] == [4, 5]
    assert [round(h["depth"], 6) for h in holes] == [6, 10]
    assert [h["through"] for h in holes] == [False, True]


def test_filleted_box_reports_fillet_radius():
    box = bd.Box(20, 20, 20)
    box = box.fillet(2, box.edges().filter_by(bd.Axis.Z))
    record = inspect_record(compound(labelled(box, "Box")), None)
    rounds = faces_of(record, "cylinder")
    assert len(rounds) == 4
    assert all(f["cylinder"]["radius"] == pytest.approx(2) for f in rounds)
    assert record["holes"] == []


def test_free_script_still_records(tmp_path):
    build(ROOT / "examples/bridge.py", tmp_path)
    text = (tmp_path / "inspect.json").read_text()
    record = json.loads(text)
    assert record["version"] == 1 and record["parts"] and record["faces"]
    assert record["warnings"] == []
    assert len(text.encode()) < 4 * 1024 * 1024


def test_face_cap_truncates():
    record = inspect_record(compound(labelled(bd.Box(1, 1, 1), "A"), labelled(bd.Pos(5, 0, 0) * bd.Box(1, 1, 1), "B")),
                            None, max_faces=10)
    assert record["faces_truncated"] is True and record["faces"] == [] and record["holes"] == []
    assert len(record["parts"]) == 2
