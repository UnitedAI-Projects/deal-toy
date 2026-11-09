import base64
import sys
from pathlib import Path

import build123d as bd
import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service
from drawing import PAPER, choose_enlargement, clean, draw, scale_label

BRIDGE = Path(__file__).resolve().parents[2] / "examples/bridge.py"


@pytest.fixture
def plate(tmp_path):
    """80 x 40 x 20 block, off the origin, with one 10 mm through hole on Z."""
    part = bd.Pos(100, 50, 5) * bd.Box(80, 40, 20) - bd.Pos(120, 50, 5) * bd.Cylinder(5, 30)
    step = tmp_path / "plate.step"
    bd.export_step(part, step)
    draw(step, {"title": "Plate", "revision": 7}, tmp_path / "out")
    return tmp_path / "out"


def rendered_dimensions(doc) -> list[str]:
    """The numbers a reader sees, which is where a wrong DIMLFAC shows up."""
    texts = []
    for dim in doc.modelspace().query("DIMENSION"):
        texts += [e.plain_text() for e in dim.get_geometry_block() if e.dxftype() == "MTEXT"]
        texts += [e.dxf.text for e in dim.get_geometry_block() if e.dxftype() == "TEXT"]
    return sorted(texts)


def extents(doc, layer):
    points = [p[:2] for e in doc.modelspace().query(f'LWPOLYLINE[layer=="{layer}"]') for p in e.get_points()]
    return points


def test_dimensions_read_the_solid(plate):
    doc = ezdxf.readfile(plate / "blueprint.dxf")
    assert not doc.audit().has_errors
    assert rendered_dimensions(doc) == ["20", "40", "80"]
    assert sorted(round(d.get_measurement(), 3) for d in doc.modelspace().query("DIMENSION")) == [20, 40, 80]


def test_views_are_placed_third_angle(plate):
    points = extents(ezdxf.readfile(plate / "blueprint.dxf"), "OUTLINE")
    front = [p for p in points if p[0] <= 80 + 1e-6 and p[1] <= 20 + 1e-6]
    assert max(p[0] for p in front) == pytest.approx(80)
    assert max(p[1] for p in front) == pytest.approx(20)
    # Top sits above the front view and the right view beside it, and neither overlaps it.
    assert min(p[1] for p in points if p[1] > 20 + 1e-6) > 20
    right = [p for p in points if p[0] > 80 + 1e-6]
    assert max(p[0] for p in right) - min(p[0] for p in right) == pytest.approx(40)


def test_sheet_states_what_it_cannot_know(plate):
    doc = ezdxf.readfile(plate / "blueprint.dxf")
    words = " ".join(e.dxf.text for e in doc.layouts.get(PAPER[0]).query("TEXT"))
    for expected in ("Plate", "7", "THIRD ANGLE", "DIA 10 x1", "TOLERANCES AND MATERIAL NOT SPECIFIED", "NOT REVIEWED"):
        assert expected in words
    assert len(doc.modelspace().query('LINE[layer=="CENTER"]')) == 2
    assert (plate / "blueprint.pdf").read_bytes()[:5] == b"%PDF-"


@pytest.mark.parametrize(("size", "label"), [((10, 5, 5), "10:1"), ((100, 55, 51), "1:1"), ((2000, 2000, 2000), "1:50")])
def test_scale_is_the_largest_that_fits(size, label):
    assert scale_label(choose_enlargement(*size)) == label


def test_oversized_model_is_refused():
    with pytest.raises(ValueError, match="too large"):
        choose_enlargement(100000, 100000, 100000)


def test_title_text_is_one_bounded_line():
    assert clean("a\nb\x00c", 60, "x") == "a b c"
    assert clean("y" * 100, 60, "x") == "y" * 60
    assert clean(None, 60, "fallback") == "fallback"


def names(result):
    return {a["name"] for a in result["artifacts"]}


CORE = {"model.step", "model.stl", "model.glb", "facts.json", "inspect.json"}


def test_a_requested_drawing_ships_beside_the_exports():
    result = service.execute(BRIDGE.read_text(), drawing={"title": "Bridge", "revision": 1})
    assert names(result) == CORE | set(service.DRAWING_FILES)
    pdf = next(a for a in result["artifacts"] if a["name"] == "blueprint.pdf")
    assert base64.b64decode(pdf["base64"])[:5] == b"%PDF-"


def test_no_drawing_unless_asked():
    assert names(service.execute(BRIDGE.read_text())) == CORE


def test_an_exhausted_budget_keeps_the_build(monkeypatch):
    monkeypatch.setattr(service, "DRAW_SECONDS", 0)
    assert names(service.execute(BRIDGE.read_text(), drawing={})) == CORE


def test_a_model_cannot_plant_a_drawing():
    planted = 'import os\nos.makedirs("drawing")\nopen("drawing/blueprint.pdf", "w").write("forged")\n'
    assert names(service.execute(planted + BRIDGE.read_text(), drawing={})) == CORE
