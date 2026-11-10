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


def pulled(shape, label, pull=(0, 0, 1)):
    from types import SimpleNamespace

    return inspect_record(compound(labelled(shape, label)), SimpleNamespace(PULL={label: pull}))


def test_draft_of_box_walls_is_zero():
    record = pulled(bd.Box(20, 10, 5, align=BOTTOM), "Box")
    (draft,) = record["draft"]
    assert draft["part"] == 0 and draft["pull"] == pytest.approx([0, 0, 1])
    assert len(draft["faces"]) == 4
    assert all(f["angle_deg"] == pytest.approx(0, abs=1e-9) and f["sampled"] is False for f in draft["faces"])


def test_draft_of_tapered_wall():
    taper = bd.extrude(bd.Rectangle(20, 20), amount=10, taper=2)
    (draft,) = pulled(taper, "Taper")["draft"]
    assert len(draft["faces"]) == 4
    assert all(f["angle_deg"] == pytest.approx(2, abs=1e-6) for f in draft["faces"])


def test_draft_on_cone():
    top = 10 - 10 * math.tan(math.radians(3))
    (draft,) = pulled(bd.Cone(10, top, 10, align=BOTTOM), "Cone")["draft"]
    (side,) = [f for f in draft["faces"] if not f["sampled"]]
    assert side["angle_deg"] == pytest.approx(3, abs=1e-6)


def test_draft_unknown_part_warns():
    from types import SimpleNamespace

    record = inspect_record(compound(labelled(bd.Box(1, 1, 1), "A")),
                            SimpleNamespace(PULL={"Nope": (0, 0, 1), "A": (0, 0, 0)}))
    assert record["draft"] == []
    assert any("Nope" in w for w in record["warnings"]) and any("zero" in w for w in record["warnings"])


def test_enclosure_fixture(tmp_path):
    build(ROOT / "examples/enclosure_inspect.py", tmp_path)
    record = json.loads((tmp_path / "inspect.json").read_text())
    labels = [p["label"] for p in record["parts"]]
    assert labels == ["Housing", "Ribs", "Cover"]
    pairs = {(p["a"], p["b"]): p for p in record["pairs"]}
    # Each rib ends at a boss axis: a 1.5 mm strip across half a 4 mm-radius disc, 10 mm tall, four times.
    half_strip = 0.75 * math.sqrt(16 - 0.75 ** 2) + 16 * math.asin(0.75 / 4)
    assert pairs[(0, 1)]["overlap_volume"] == pytest.approx(4 * 10 * half_strip, abs=1e-6)
    assert pairs[(0, 2)]["overlap_volume"] == pytest.approx(0, abs=1e-9)
    dims = {d["name"]: d for d in record["dimensions"]}
    assert dims["Lip clearance"]["value"] == pytest.approx(0.3, abs=1e-6)
    assert dims["Lip clearance"]["matches_param"] and dims["Wall thickness"]["matches_param"]
    (draft,) = record["draft"]
    housing = [f for f in record["faces"] if f["part"] == 0]
    walls = [f["index"] for f in housing if f["type"] == "plane" and abs(f["plane"]["normal"][2]) < 1e-9]
    angles = {f["index"]: f["angle_deg"] for f in draft["faces"]}
    assert walls and all(angles[i] == pytest.approx(0, abs=1e-9) for i in walls)
    assert record["warnings"] == []


@pytest.mark.parametrize("example", ["bridge.py", "deal_toy_inspect.py", "deal_toy_steps.py", "enclosure_inspect.py", "display_box_fit.py"])
def test_step_reload_keeps_face_indices(tmp_path, example):
    build(ROOT / "examples" / example, tmp_path)
    record = json.loads((tmp_path / "inspect.json").read_text())
    reloaded = inspect_record(bd.import_step(tmp_path / "model.step"), None)
    assert [p["label"] for p in reloaded["parts"]] == [p["label"] for p in record["parts"]]
    assert len(reloaded["faces"]) == len(record["faces"])
    for a, b in zip(record["faces"], reloaded["faces"], strict=True):
        assert (a["part"], a["type"]) == (b["part"], b["type"])
        assert a["area"] == pytest.approx(b["area"], abs=1e-6)
        assert a["center"] == pytest.approx(b["center"], abs=1e-6)


def _close(a, b, path="record"):
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), f"{path}: keys differ"
        for key in a:
            _close(a[key], b[key], f"{path}.{key}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), f"{path}: lengths differ"
        for k, (x, y) in enumerate(zip(a, b, strict=True)):
            _close(x, y, f"{path}[{k}]")
    elif isinstance(a, float) or isinstance(b, float):
        assert a == pytest.approx(b, abs=1e-5), path
    else:
        assert a == b, path


@pytest.mark.parametrize("name", ["deal_toy_inspect", "enclosure_inspect", "display_box_fit", "display_box_fit_posed"])
def test_stored_worker_fixtures_are_current(name):
    sys.path.insert(0, str(ENGINE / "tools"))
    from gen_fixtures import FIXTURES, record_of

    stored = json.loads((ENGINE / "tests" / "fixtures" / f"{name}.inspect.json").read_text())
    _close(record_of(FIXTURES[name]), stored)


BOX = ROOT / "examples/display_box_fit.py"


def box_record(tmp_path, angle=None, out=None, source=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    text = source or BOX.read_text()
    if angle is not None:
        text += f'\nPARAMS["LID_ANGLE"]["value"] = {angle}\n'
    if out is not None:
        text += f'\nPARAMS["DRAWER_OUT"]["value"] = {out}\n'
    return run_fixture(tmp_path, text)


def test_display_box_joints(tmp_path):
    record = box_record(tmp_path)
    labels = [p["label"] for p in record["parts"]]
    assert labels == ["Base", "Lid", "Drawer", "Plaque"]
    joints = {labels[j["part"]]: j for j in record["joints"]}
    assert list(joints) == ["Lid", "Drawer", "Plaque"]
    lid, drawer, plaque = joints["Lid"], joints["Drawer"], joints["Plaque"]
    assert (lid["kind"], lid["name"], labels[lid["to"]]) == ("revolute", "hinge", "Base")
    assert lid["value"] == 0 and lid["range"] == [0, 110] and lid["unit"] == "deg"
    assert lid["origin"] == pytest.approx([0, 40, 40]) and lid["axis"] == pytest.approx([-1, 0, 0])
    assert (drawer["kind"], labels[drawer["to"]], drawer["unit"]) == ("linear", "Base", "mm")
    assert drawer["value"] == 0 and drawer["range"] == [0, 40]
    assert drawer["origin"] == pytest.approx([0, -40, 6]) and drawer["axis"] == pytest.approx([0, -1, 0])
    assert (plaque["kind"], labels[plaque["to"]], plaque["range"], plaque["value"]) == ("rigid", "Lid", [0, 0], 0)
    assert record["warnings"] == []


def test_placement_dimensions(tmp_path):
    record = box_record(tmp_path)
    dims = {d["name"]: d for d in record["dimensions"]}
    lid, drawer = dims["Lid angle"], dims["Drawer travel"]
    assert (lid["param"], lid["unit"], lid["matches_param"], lid["value"]) == ("LID_ANGLE", "deg", True, 0)
    assert (drawer["param"], drawer["unit"], drawer["matches_param"]) == ("DRAWER_OUT", "mm", True)
    assert record["joints"][lid["joint"]]["kind"] == "revolute"
    assert record["joints"][drawer["joint"]]["kind"] == "linear"
    assert "faces" not in lid and "moves" not in lid
    fixed = BOX.read_text().replace("position=out", "position=0")
    stale = box_record(tmp_path / "stale", out=12, source=fixed)
    assert {d["name"]: d["matches_param"] for d in stale["dimensions"]}["Drawer travel"] is False


def test_joint_value_follows_param(tmp_path):
    closed = box_record(tmp_path / "closed")
    opened = box_record(tmp_path / "open", angle=60, out=25)
    values = {j["name"]: j["value"] for j in opened["joints"]}
    assert values["hinge"] == pytest.approx(60) and values["slide"] == pytest.approx(25)
    com = {p["label"]: p["center_of_mass"] for p in closed["parts"]}
    moved = {p["label"]: p["center_of_mass"] for p in opened["parts"]}
    assert moved["Drawer"] == pytest.approx([com["Drawer"][0], com["Drawer"][1] - 25, com["Drawer"][2]])
    assert moved["Plaque"] != pytest.approx(com["Plaque"])


def _blocks(*labels):
    return [labelled(bd.Pos(20 * k, 0, 0) * bd.Box(10, 10, 10, align=BOTTOM), label) for k, label in enumerate(labels)]


def test_joint_edge_cases():
    a, b, c = _blocks("A", "B", "C")
    j1 = bd.LinearJoint("j1", a, axis=bd.Axis((0, 0, 10), (0, 0, 1)), linear_range=(0, 5))
    j2 = bd.LinearJoint("j2", c, axis=bd.Axis((40, 0, 10), (0, 0, 1)), linear_range=(0, 5))
    held = bd.RigidJoint("held", b, bd.Location((20, 0, 0)))
    j1.connect_to(held, position=0)
    j2.connect_to(held, position=0)
    record = inspect_record(compound(a, b, c), None)
    assert [(j["name"], j["part"]) for j in record["joints"]] == [("j1", 1)]
    assert 'Part "B" is moved by two joints; only "j1" is used' in record["warnings"]

    a, b = _blocks("A", "B")
    ab = bd.RigidJoint("ab", a, bd.Location((10, 0, 0)))
    ba = bd.RigidJoint("ba", b, bd.Location((20, 0, 0)))
    ab.connect_to(ba)
    back = bd.RigidJoint("back", b, bd.Location((20, 0, 0)))
    front = bd.RigidJoint("front", a, bd.Location((10, 0, 0)))
    back.connect_to(front)
    record = inspect_record(compound(a, b), None)
    assert len(record["joints"]) == 1
    assert any("cycle" in w for w in record["warnings"])

    a, b = _blocks("A", "B")
    rigid = bd.RigidJoint("seat", a, bd.Location((0, 0, 10)))
    slider = bd.LinearJoint("rail", b, axis=bd.Axis((20, 0, 0), (0, 0, 1)), linear_range=(0, 5))
    rigid.connect_to(slider, position=0)
    record = inspect_record(compound(a, b), None)
    assert record["joints"][0]["kind"] == "rigid"
    assert 'Joint "seat": connect from the LinearJoint on "B" to record its motion' in record["warnings"]

    a, b = _blocks("A", "B")
    ball = bd.BallJoint("ball", a, bd.Location((0, 0, 10)))
    cap = bd.RigidJoint("cap", b, bd.Location((20, 0, 0)))
    ball.connect_to(cap)
    record = inspect_record(compound(a, b), None)
    assert record["joints"][0]["kind"] == "rigid"
    assert any("BallJoint" in w for w in record["warnings"])

    a, b = _blocks("A", "B")
    open_rail = bd.LinearJoint("open", a, axis=bd.Axis((0, 0, 10), (0, 0, 1)))
    stop = bd.RigidJoint("stop", b, bd.Location((20, 0, 0)))
    open_rail.connect_to(stop, position=3)
    record = inspect_record(compound(a, b), None)
    assert record["joints"][0]["range"] == [0, None] and record["joints"][0]["value"] == 3
    json.dumps(record, allow_nan=False)


def test_revolute_angle_attribute_is_still_private_angle():
    # The record reads RevoluteJoint._angle; fail loudly if a build123d upgrade renames it.
    a, b = _blocks("A", "B")
    hinge = bd.RevoluteJoint("h", a, axis=bd.Axis((0, 0, 10), (1, 0, 0)), angular_range=(0, 90))
    hinge.connect_to(bd.RigidJoint("p", b, bd.Location((20, 0, 0))), angle=30)
    assert hinge._angle == 30
