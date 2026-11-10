"""MantelCAD designs: detection, parameters, edit validation and STEP-based exports.

The end-to-end build through mantelcad-cli runs when the CLI is installed (the container image,
or MANTELCAD_CLI pointing at a local build); CI's container smoke test always runs it.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service
from runner import build_from_step, design_params
from service import design_of, execute, execute_edit

ROOT = Path(__file__).resolve().parents[2]
DESIGN = (ROOT / "examples/bracket.mantelcad.json").read_text()
STEP = Path(__file__).with_name("fixtures") / "bracket-mantelcad.step"


def test_only_mantelcad_documents_are_designs():
    assert design_of(DESIGN)["name"] == "bracket"
    assert design_of("def build():\n    return None\n") is None
    assert design_of('{"format": "something-else/1"}') is None
    assert design_of('{"format": "solidcraft/52"') is None
    assert design_of("[1, 2]") is None


def test_design_parameters_are_its_named_literal_values():
    params = design_params({"params": [
        {"name": "width", "expr": "60 mm", "unit": "mm", "model": False},
        {"name": "angle", "expr": "-2.5e1 deg", "unit": "deg", "model": False},
        {"name": "count", "expr": "4", "unit": "", "model": False},
        {"name": "half", "expr": "width / 2", "unit": "mm", "model": False},
        {"name": "d1", "expr": "10 mm", "unit": "mm", "model": True},
        {"name": "bad name", "expr": "1 mm", "model": False},
    ]})
    assert params == {"width": {"value": 60.0, "unit": "mm"}, "angle": {"value": -25.0, "unit": "deg"},
                      "count": {"value": 4.0}}
    assert design_params({"params": []}) is None


def test_step_exports_keep_mantelcads_body_names_and_parameters(tmp_path):
    design = tmp_path / "design.json"
    design.write_text(DESIGN)
    out = tmp_path / "out"
    facts = build_from_step(STEP, out, design)
    assert facts["parts"] == [{"label": "Bracket", "volume_mm3": pytest.approx(22385.31, rel=1e-4)}]
    assert facts["params"]["width"] == {"value": 60.0, "unit": "mm"}
    assert facts["bounds"] == pytest.approx([40, 60, 30])
    assert (out / "model.glb").read_bytes()[:4] == b"glTF"
    assert (out / "model.stl").stat().st_size > 84
    record = json.loads((out / "inspect.json").read_text())
    assert record["parts"][0]["label"] == "Bracket"
    assert len(record["holes"]) == 2
    assert not (out / "model.step").exists()  # the service keeps MantelCAD's own STEP


@pytest.mark.parametrize("commands", [
    [],
    [{"command": "file.save", "params": {}}],
    [{"command": "render.image", "params": {}}],
    [{"command": "sketch.insert_svg", "params": {}}],
    [{"command": "solid.extrude", "params": [1]}],
    [{"command": "solid.extrude", "extra": 1}],
    [{"command": "Solid.Extrude"}],
    [{"command": "solid.extrude"}] * 61,
])
def test_edits_accept_only_modelling_commands(commands):
    with pytest.raises(ValueError, match="command"):
        execute_edit(DESIGN, commands)


def test_edits_and_builds_need_a_design():
    with pytest.raises(ValueError, match="design"):
        execute_edit("def build(): pass", [{"command": "solid.extrude", "params": {}}])
    with pytest.raises(ValueError, match="view-as-of"):
        execute(DESIGN, stop_after=1)
    with pytest.raises(ValueError, match="1 MB"):
        execute(DESIGN.rstrip()[:-1] + ',"pad":"' + "x" * 1_000_000 + '"}')


def cli_runs() -> bool:
    """Whether the installed CLI runs on this host (engine/bin holds a Linux build)."""
    try:
        return subprocess.run([str(service.CLI), "commands"], capture_output=True, timeout=60,
                              check=False).returncode == 0
    except OSError:
        return False


needs_cli = pytest.mark.skipif(not cli_runs(), reason="mantelcad-cli is not installed for this host")


@needs_cli
def test_a_design_builds_through_mantelcad():
    names = [a["name"] for a in execute(DESIGN)["artifacts"]]
    assert names == ["model.step", "model.stl", "model.glb", "facts.json", "inspect.json"]


@needs_cli
def test_an_edit_returns_the_edited_design_or_mantelcads_error():
    edited = execute_edit(DESIGN, [{"command": "parameters.change",
                                    "params": {"name": "width", "expression": "80 mm"}}])
    assert {p["name"]: p["expr"] for p in json.loads(edited["design"])["params"]}["width"] == "80 mm"
    with pytest.raises(ValueError, match="solid.fillet"):
        execute_edit(DESIGN, [{"command": "solid.fillet", "params": {"edges": [[999, 0, 0]], "radius": 2}}])


def test_step_colours_follow_each_styled_body_to_its_rgb():
    from runner import step_colours
    text = """
#10=MANIFOLD_SOLID_BREP('Base',#9);
#11=MANIFOLD_SOLID_BREP('Rocket''s nose',#8);
#20=COLOUR_RGB('',0.1,0.2,0.3);
#21=FILL_AREA_STYLE_COLOUR('',#20);
#22=FILL_AREA_STYLE('',(#21));
#23=SURFACE_STYLE_FILL_AREA(#22);
#24=SURFACE_SIDE_STYLE('',(#23));
#25=SURFACE_STYLE_USAGE(.BOTH.,#24);
#26=PRESENTATION_STYLE_ASSIGNMENT((#25));
#27=STYLED_ITEM('color',(#26),#10);
#28=STYLED_ITEM('color',(#26),#11);
"""
    assert step_colours(text) == {"Base": (0.1, 0.2, 0.3), "Rocket's nose": (0.1, 0.2, 0.3)}
