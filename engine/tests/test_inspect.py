import json
import math
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


def run_fixture(tmp_path, source=None):
    path = tmp_path / "model.py"
    path.write_text(source or (ROOT / "examples/deal_toy_inspect.py").read_text())
    build(path, tmp_path / "out")
    return json.loads((tmp_path / "out" / "inspect.json").read_text())


def test_pairs_distance_and_overlap():
    a = labelled(bd.Box(10, 10, 10, align=BOTTOM), "A")
    b = labelled(bd.Pos(15, 0, 0) * bd.Box(10, 10, 10, align=BOTTOM), "B")
    c = labelled(bd.Pos(-9, 0, 0) * bd.Box(10, 10, 10, align=BOTTOM), "C")
    record = inspect_record(compound(a, b, c), None)
    pairs = {(p["a"], p["b"]): p for p in record["pairs"]}
    assert pairs[(0, 1)]["distance"] == pytest.approx(5) and pairs[(0, 1)]["overlap_volume"] == 0
    assert pairs[(0, 2)]["distance"] == 0 and pairs[(0, 2)]["overlap_volume"] == pytest.approx(100)


def test_stability_of_a_box():
    record = inspect_record(compound(labelled(bd.Box(10, 10, 40, align=BOTTOM), "Tower")), None)
    stability = record["stability"]
    assert stability["uniform_density"] is True
    assert stability["tip_angle_deg"] == pytest.approx(math.degrees(math.atan(5 / 20)), abs=1e-6)
    assert sorted(map(tuple, stability["footprint"])) == [(-5, -5), (-5, 5), (5, -5), (5, 5)]


def test_deal_toy_fixture(tmp_path):
    record = run_fixture(tmp_path)
    assert [p["label"] for p in record["parts"]] == ["Base", "Block", "Coin"]
    (embed,) = record["embeds"]
    assert (embed["part"], embed["in"], embed["contained"]) == (2, 1, True)
    assert embed["wall"] == pytest.approx(1.5, abs=1e-6)
    (depth,) = record["dimensions"]
    assert depth["name"] == "Engraving depth" and depth["value"] == pytest.approx(0.3, abs=1e-6)
    assert depth["matches_param"] is False and depth["moves"] in depth["faces"]
    stability = record["stability"]
    assert stability["uniform_density"] is False
    # Expected centre of mass from the recorded part volumes and centroids, weighted by density.
    density = {"Base": 0.7, "Block": 1.19, "Coin": 8.5}
    mass = [p["volume"] * density[p["label"]] for p in record["parts"]]
    com = [sum(m * p["center_of_mass"][k] for m, p in zip(mass, record["parts"])) / sum(mass) for k in range(3)]
    assert stability["center_of_mass"] == pytest.approx(com, abs=1e-6)
    expected = math.degrees(math.atan((20 - abs(com[1])) / com[2]))
    assert stability["tip_angle_deg"] == pytest.approx(expected, abs=0.1)
    assert record["materials"]["Coin"]["density_g_cm3"] == 8.5
    assert record["warnings"] == []


def test_missing_density_assumes_uniform(tmp_path):
    source = (ROOT / "examples/deal_toy_inspect.py").read_text().replace(
        '    "Coin": {"name": "brass", "density_g_cm3": 8.5},\n', "")
    assert run_fixture(tmp_path, source)["stability"]["uniform_density"] is True


def test_declared_dimension_matches_param(tmp_path):
    source = (ROOT / "examples/deal_toy_inspect.py").read_text().replace('"value": 0.5, "unit": "mm", "part": "Base"',
                                                                         '"value": 0.3, "unit": "mm", "part": "Base"')
    assert run_fixture(tmp_path, source)["dimensions"][0]["matches_param"] is True


def test_sphere_on_table_does_not_tip_check_crash():
    record = inspect_record(compound(labelled(bd.Sphere(10, align=BOTTOM), "Ball")), None)
    assert record["stability"]["tip_angle_deg"] == 0


def test_duplicate_labels_warn():
    record = inspect_record(compound(labelled(bd.Box(1, 1, 1), "A"), labelled(bd.Pos(3, 0, 0) * bd.Box(1, 1, 1), "A")),
                            None)
    assert record["warnings"] == ['Two parts are labelled "A"']
    assert len(record["parts"]) == 2


def test_faces_carry_created_names_and_sides(tmp_path):
    build(ROOT / "examples/deal_toy_steps.py", tmp_path)
    record = json.loads((tmp_path / "inspect.json").read_text())
    base = next(p["index"] for p in record["parts"] if p["label"] == "Base")
    walls = [f for f in record["faces"] if {"of": "Mount hole", "name": "wall"} in f.get("names", [])]
    assert walls and all(f["type"] == "cylinder" and f["part"] == base for f in walls)
    bottoms = [f for f in record["faces"] if f["part"] == base and "bottom" in f.get("sides", [])]
    assert len(bottoms) == 1 and bottoms[0]["plane"]["normal"] == pytest.approx([0, 0, -1])
    free = inspect_record(compound(labelled(bd.Box(1, 1, 1), "A")), None)
    assert all("names" not in f for f in free["faces"])
