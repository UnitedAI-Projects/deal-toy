import base64
import sys
from pathlib import Path

import build123d as bd
import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service
from drawing import (
    PANEL_WIDTH,
    PAPER,
    bands,
    choose_enlargement,
    clean,
    draw,
    panel_sections,
    scale_label,
)

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


DETAILS = {
    "project": "Anthropic IPO",
    "materials": [{"part": "Body", "name": "C360 brass"}],
    "dimensions": [{"name": "Body width", "value": 76, "matches": True}, {"name": "Step", "value": 72, "matches": False}],
    "holes": [{"part": "Body", "diameter": 3.3, "depth": 10, "blind": True, "at": [-25, 0, 18]}],
    "text": [{"name": "Text line 1", "bbox": {"min": [-18.67, -7, 59.77], "max": [18.67, -6.7, 67.23]}}],
}


def sheet_words(tmp_path, spec, size=(80, 40, 20)):
    step = tmp_path / "part.step"
    bd.export_step(bd.Box(*size), step)
    draw(step, spec, tmp_path / "out")
    doc = ezdxf.readfile(tmp_path / "out" / "blueprint.dxf")
    assert not doc.audit().has_errors
    return [e.dxf.text for e in doc.layouts.get(PAPER[0]).query("TEXT")]


def test_the_panel_prints_what_the_build_measured(tmp_path):
    words = sheet_words(tmp_path, {"title": "Toy", "revision": 3, **DETAILS})
    for expected in ("Anthropic IPO", "C360 brass", "Body width", "76.00", "72.00 CHECK", "H1", "3.30", "10.00 BLIND",
                     "-25.00, 0.00, 18.00", "Text line 1", "-18.67 to 18.67", "59.77 to 67.23"):
        assert expected in words
    assert "2. TOLERANCES NOT SPECIFIED. SEE THE MANUFACTURING BRIEF." in words


def test_a_sheet_without_measurements_has_no_panel(tmp_path):
    words = sheet_words(tmp_path, {"title": "Toy", "revision": 3})
    assert "FEATURE DIMENSIONS" not in words
    assert any("TOLERANCES AND MATERIAL NOT SPECIFIED" in w for w in words)


def test_rows_that_cannot_be_read_are_left_off():
    spec = {"dimensions": [{"name": "Good", "value": 1}, {"name": "Infinite", "value": float("inf")}, {"name": "None"},
                           "not a row"], "holes": "nope", "materials": None, "text": [{"name": "x", "bbox": {}}]}
    assert panel_sections(spec) == [("FEATURE DIMENSIONS", (("NAME", 0), ("MM", 100)), [("Good", "1.00")])]


def test_rows_past_the_end_of_the_sheet_are_counted(tmp_path):
    many = [{"name": f"Dimension {i}", "value": i, "matches": True} for i in range(200)]
    words = sheet_words(tmp_path, {"title": "Toy", "revision": 3, "dimensions": many})
    assert "Dimension 0" in words
    assert "Dimension 199" not in words
    shown = sum(w.startswith("Dimension ") for w in words)
    assert f"{200 - shown} MORE ROWS DO NOT FIT. SEE INSPECT.JSON." in words


def test_the_panel_takes_width_from_the_views():
    assert scale_label(choose_enlargement(190, 60, 40)) == "1:1"
    assert scale_label(choose_enlargement(190, 60, 40, PANEL_WIDTH)) == "1:2"


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


@pytest.fixture(scope="module")
def built():
    result = service.execute(BRIDGE.read_text())
    assert names(result) == CORE, "a build must not draw; drawing is its own job"
    return next(a["base64"] for a in result["artifacts"] if a["name"] == "model.step")


def test_a_drawing_job_reads_only_the_step(built):
    result = service.execute_drawing(built, {"title": "Bridge", "revision": 1})
    assert names(result) == set(service.DRAWING_FILES)
    pdf = next(a for a in result["artifacts"] if a["name"] == "blueprint.pdf")
    assert base64.b64decode(pdf["base64"])[:5] == b"%PDF-"


def test_a_failed_drawing_says_why():
    broken = base64.b64encode(b"ISO-10303-21;\nnot a real step file").decode()
    with pytest.raises(ValueError, match="Drawing failed"):
        service.execute_drawing(broken, {})


def test_a_drawing_is_stopped_at_its_limit(built):
    with pytest.raises(ValueError, match="time limit"):
        service.execute_drawing(built, {}, timeout=0.01)


@pytest.mark.parametrize("step", ["", "not base64!", base64.b64encode(b"plain text").decode(), None])
def test_only_a_step_file_is_drawn(step):
    with pytest.raises(ValueError, match="STEP"):
        service.execute_drawing(step, {})


def test_the_spec_must_be_an_object(built):
    with pytest.raises(ValueError, match="spec"):
        service.execute_drawing(built, "title")


def stacked(tmp_path, spec):
    """A 90 x 50 x 18 base carrying a 76 x 14 x 92 body, as two solids."""
    base = bd.Box(90, 50, 18, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    body = bd.Pos(0, 0, 18) * bd.Box(76, 14, 92, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    step = tmp_path / "stack.step"
    bd.export_step(bd.Compound(children=[base, body]), step)
    result = draw(step, spec, tmp_path / "out")
    return ezdxf.readfile(tmp_path / "out" / "blueprint.dxf"), result


def test_stacked_parts_get_step_dimensions_on_the_views(tmp_path):
    doc, _ = stacked(tmp_path, {"title": "Toy", "revision": 3})
    assert not doc.audit().has_errors
    measured = sorted(round(d.get_measurement(), 3) for d in doc.modelspace().query("DIMENSION"))
    for expected in (18, 92, 76, 90, 50, 110):
        assert expected in measured
    words = [e.dxf.text for e in doc.layouts.get(PAPER[0]).query("TEXT")]
    assert any("STEPS BETWEEN THE EXTENTS" in w for w in words)


def test_narrow_steps_and_lettering_are_not_dimensioned():
    assert bands([(0, 10), (10, 12), (12, 40)], 5) == [(0, 10), (12, 40)]
    assert bands([(0, 40)], 5) == []
    assert bands([(i, i + 0.5) for i in range(20)], 0.1) == []


def test_the_sheet_has_an_isometric_view_clear_of_the_others(tmp_path):
    doc, result = stacked(tmp_path, {"title": "Toy", "revision": 3})
    assert result["pictorial"]
    points = [p[:2] for e in doc.modelspace().query('LWPOLYLINE[layer=="PICTORIAL"]') for p in e.get_points()]
    assert points
    assert min(p[0] for p in points) > 90
    assert min(p[1] for p in points) > 110


def test_materials_list_volume_mass_and_total():
    spec = {"materials": [{"part": "Base", "name": "Walnut", "volume": 80049.0, "mass": 48.83},
                          {"part": "Body", "name": "C360 brass", "volume": 87005.0, "mass": 739.54}]}
    assert panel_sections(spec)[0][2] == [("Base", "Walnut", "80,049", "48.83"), ("Body", "C360 brass", "87,005", "739.54"),
                                          ("TOTAL", "", "", "788.37")]


def test_a_partial_mass_has_no_total():
    spec = {"materials": [{"part": "Base", "name": "Walnut", "volume": 1.0, "mass": 1.0}, {"part": "Body", "name": "Brass"}]}
    assert panel_sections(spec)[0][2] == [("Base", "Walnut", "1", "1.00"), ("Body", "Brass", "-", "-")]
