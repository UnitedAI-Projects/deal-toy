import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runner import build

ROOT = Path(__file__).resolve().parents[2]


def script(steps, base="None", params="{}", extra=""):
    """A model in the standard steps layout."""
    lines = "\n".join("    " + s for s in steps)
    return (
        "import build123d as bd\nimport mantel as mt\n\n"
        f"PARAMS = {params}\n\n{extra}\n\n"
        f"def base():\n    return {base}\n\n\n"
        "def build():\n"
        "    m = mt.Model(base(), params=PARAMS)\n"
        "    # mantel:steps begin\n"
        f"{lines}\n"
        "    # mantel:steps end\n"
        "    return m.result()\n"
    )


def run(tmp_path, source, name="model"):
    path = tmp_path / f"{name}.py"
    path.write_text(source)
    return build(path, tmp_path / f"{name}-out")


def states(facts):
    return {s["name"]: s["state"] for s in facts["steps"]}


def step(facts, name):
    return next(s for s in facts["steps"] if s["name"] == name)


BLOCK = 'm.body("Block", shape="box", size=(40, 20, 30))'


def test_body_and_plane_steps_ok(tmp_path):
    facts = run(tmp_path, script([
        BLOCK,
        'm.plane("Mid plane", method="midplane", between=[m.face("Block", "left"), m.face("Block", "right")])',
        'm.plane("Above", method="offset", reference=m.face("Block", "top"), distance=5)',
    ]))
    assert states(facts) == {"Block": "ok", "Mid plane": "ok", "Above": "ok"}
    assert facts["incomplete"] is False
    assert [p["label"] for p in facts["parts"]] == ["Block"]
    assert facts["parts"][0]["volume_mm3"] == pytest.approx(40 * 20 * 30)
    assert step(facts, "Block")["action"] == "body"
    assert step(facts, "Block")["version"] == 1


def test_sides_resolve_on_every_axis(tmp_path):
    facts = run(tmp_path, script([BLOCK] + [
        f'm.plane("P {side}", method="offset", reference=m.face("Block", "{side}"), distance=1)'
        for side in ("top", "bottom", "left", "right", "front", "back")
    ]))
    assert set(states(facts).values()) == {"ok"}


def test_missing_face_fails_without_drift(tmp_path):
    query = 'm.face("Block", normal=(1, 1, 0), near=(0, 0, 0))'
    facts = run(tmp_path, script([BLOCK, f'm.body("Peg", shape="cylinder", diameter=4, height=5, on={query})']))
    peg = step(facts, "Peg")
    assert (peg["state"], peg["code"]) == ("failed", "face_not_found")
    assert facts["incomplete"] is True
    assert [p["label"] for p in facts["parts"]] == ["Block"]
    assert facts["volume_mm3"] == pytest.approx(40 * 20 * 30)


def test_ambiguous_query_fails(tmp_path):
    extra = (
        "def twin(m):\n"
        "    m.parts['Block'] = m.parts['Block'] + bd.Pos(20, 0, 0) * bd.Box(10, 10, 10, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))\n"
    )
    facts = run(tmp_path, script([
        'm.body("Block", shape="box", size=(10, 10, 10))',
        'm.custom("Twin", fn=twin)',
        'm.plane("Top", method="offset", reference=m.face("Block", normal=(0, 0, 1), near=(10, 0, 10)), distance=1)',
    ], extra=extra))
    assert states(facts)["Twin"] == "ok"
    top = step(facts, "Top")
    assert (top["state"], top["code"]) == ("failed", "ambiguous_reference")


def test_blocked_and_suppressed(tmp_path):
    facts = run(tmp_path, script([
        BLOCK,
        'm.plane("Mid plane", method="midplane", between=[m.face("Block", "left"), m.face("Block", "right")], suppressed=True)',
        'm.plane("Above", method="offset", reference=m.datum("Mid plane"), distance=5)',
    ]))
    assert states(facts) == {"Block": "ok", "Mid plane": "suppressed", "Above": "blocked"}
    assert "Mid plane" in step(facts, "Above")["message"]
    assert facts["incomplete"] is True


def test_duplicate_name_fails(tmp_path):
    facts = run(tmp_path, script([BLOCK, 'm.body("Block", shape="box", size=(5, 5, 5))']))
    assert [s["state"] for s in facts["steps"]] == ["ok", "failed"]
    assert facts["steps"][1]["code"] == "duplicate_name"
    assert facts["volume_mm3"] == pytest.approx(40 * 20 * 30)


def test_invalid_input_fails_the_step(tmp_path):
    facts = run(tmp_path, script([BLOCK, 'm.body("Lid", shape="box")', 'm.body("Big", shape="box", size=(5, 5, 9000))']))
    lid, big = step(facts, "Lid"), step(facts, "Big")
    assert (lid["state"], lid["code"]) == ("failed", "invalid_input")
    assert "size" in lid["message"]
    assert (big["code"], "2000" in big["message"]) == ("invalid_input", True)


def test_params_drive_inputs(tmp_path):
    facts = run(tmp_path, script(
        ['m.body("Block", shape="box", size=(mt.P("W"), 20, 30))'],
        params='{"W": {"value": 50.0, "unit": "mm", "min": 10, "max": 100}}'))
    assert facts["volume_mm3"] == pytest.approx(50 * 20 * 30)


def test_custom_fn_runs_and_errors_roll_back(tmp_path):
    extra = (
        "def add_peg(m, height):\n"
        "    m.parts['Peg'] = bd.Pos(0, 0, 30) * bd.Box(2, 2, height, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))\n\n"
        "def boom(m):\n"
        "    m.parts['Block'] = m.parts['Block'] + bd.Pos(100, 0, 0) * bd.Box(1, 1, 1)\n"
        "    raise RuntimeError('boom')\n"
    )
    facts = run(tmp_path, script([
        BLOCK,
        'm.custom("Peg", fn=add_peg, height=4)',
        'm.custom("Broken", fn=boom)',
        'm.body("After", shape="box", size=(1, 1, 1), at=(50, 0, 0))',
    ], extra=extra))
    broken = step(facts, "Broken")
    assert (broken["state"], broken["code"], broken["message"]) == ("failed", "internal_error", "boom")
    assert states(facts)["Peg"] == "ok" and states(facts)["After"] == "ok"
    assert facts["volume_mm3"] == pytest.approx(40 * 20 * 30 + 2 * 2 * 4 + 1)


def test_free_script_has_no_steps_facts(tmp_path):
    facts = build(ROOT / "examples/bridge.py", tmp_path)
    assert "steps" not in facts and "incomplete" not in facts


# The remaining batch-1 actions, on the reference deal-toy fixture.

import json
import math
import re

import build123d as bd
from OCP.Font import Font_FontAspect, Font_FontMgr, Font_StrictLevel
from OCP.TCollection import TCollection_AsciiString

FIXTURE = Path(__file__).with_name("fixtures") / "deal_toy.py"
CATALOG = json.loads((ROOT / "engine/lib/mantel/catalog.json").read_text())


def has_font(name="Liberation Sans"):
    manager = Font_FontMgr.GetInstance_s()
    manager.InitFontDataBase()
    return manager.FindFont(TCollection_AsciiString(name), Font_StrictLevel.Font_StrictLevel_Strict,
                            Font_FontAspect.Font_FontAspect_Regular, False) is not None


needs_font = pytest.mark.skipif(not has_font(), reason="Liberation Sans is installed in the build image and CI only")


def fixture(**changes):
    source = FIXTURE.read_text()
    for name, value in changes.items():
        if name == "radius":
            source = source.replace("radius=2)", f"radius={value})")
            continue
        source, n = re.subn(rf'("{name}": \{{"value": )[0-9.]+', rf"\g<1>{float(value)}", source)
        assert n == 1, name
    return source


def faces_in_step(out_dir):
    return bd.import_step(out_dir / "model.step").faces()


@needs_font
def test_fixture_builds_every_step_ok(tmp_path):
    facts = run(tmp_path, fixture())
    assert [s["state"] for s in facts["steps"]] == ["ok"] * 7, facts["steps"]
    assert facts["incomplete"] is False
    assert [p["label"] for p in facts["parts"]] == ["Base", "Coin", "Block"]
    assert step(facts, "Mount hole")["created"] == ["wall"]
    assert step(facts, "Block edges")["created"] == ["rounds"]


EXAMPLE_BASE = ("bd.Compound(children=[_label(bd.Box(100, 40, 10, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)), 'Base'), "
                "_label(bd.Pos(0, 0, 3) * bd.Cylinder(8, 3, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)), 'Coin')])")
LABEL = "def _label(shape, label):\n    shape.label = label\n    return shape\n"


@pytest.mark.parametrize("action", [a for a in CATALOG["actions"] if a["id"] != "custom"], ids=lambda a: a["id"])
def test_each_catalog_example_builds(tmp_path, action):
    if action["id"] == "text" and not has_font():
        pytest.skip("Liberation Sans is installed in the build image and CI only")
    facts = run(tmp_path, script([action["example"]], base=EXAMPLE_BASE, extra=LABEL))
    entry = facts["steps"][0]
    assert entry["state"] == "ok", entry
    assert set(entry["created"]) <= set(action["creates"])
    if action["creates"] and action["id"] not in ("hole",):
        assert entry["created"]
    if action["id"] == "hole":
        assert entry["created"] == ["wall"]


@needs_font
@pytest.mark.parametrize(("width", "diameter"), [(40, 2), (80, 5), (150, 10), (150, 2)])
def test_references_survive_param_changes(tmp_path, width, diameter):
    facts = run(tmp_path, fixture(BLOCK_W=width, HOLE_D=diameter))
    assert set(states(facts).values()) == {"ok"}, facts["steps"]
    walls = [f for f in faces_in_step(tmp_path / "model-out")
             if f.geom_type == bd.GeomType.CYLINDER and abs(f.radius - diameter / 2) < 1e-6
             and abs(f.axis_of_rotation.position.X + 30) < 1e-6 and abs(f.axis_of_rotation.position.Y) < 1e-6]
    assert walls
    assert all(abs(abs(f.axis_of_rotation.direction.Z) - 1) < 1e-9 for f in walls)
    assert all(-1e-6 <= f.bounding_box().min.Z and f.bounding_box().max.Z <= 10 + 1e-6 for f in walls)


def test_ambiguity_after_param_change(tmp_path):
    tilt = math.radians(10)
    # Named sides move as material is added, so both bosses start from a plane taken before either exists.
    boss = ('m.extrude("{name}", on=m.datum("Deck"), profile="rectangle", width=6, length=6, at=({x}, 0, 0), '
            'distance=5, taper=10, operation="join", target=m.part("Pad"))')
    steps = [
        'm.body("Pad", shape="box", size=(100, 40, 5))',
        'm.plane("Deck", method="offset", reference=m.face("Pad", "top"), distance=0)',
        boss.format(name="Boss", x=-30),
        boss.format(name="Boss 2", x='mt.P("HOLE_X")'),
        (f'm.plane("Probe", method="offset", reference=m.face("Pad", normal=({math.cos(tilt):.5f}, 0, {math.sin(tilt):.5f}), '
         'near=(2.56, 0, 7.5)), distance=0)'),
    ]
    params = '{{"HOLE_X": {{"value": {x}, "unit": "mm", "min": 10, "max": 40}}}}'
    near = run(tmp_path, script(steps, params=params.format(x=20.0)), "near")
    assert set(states(near).values()) == {"ok"}, near["steps"]
    tied = run(tmp_path, script(steps, params=params.format(x=30.0)), "tied")
    probe = step(tied, "Probe")
    assert (probe["state"], probe["code"]) == ("failed", "ambiguous_reference")


@needs_font
def test_fillet_radius_clamped_warns(tmp_path):
    facts = run(tmp_path, fixture(radius=50))
    fillet = step(facts, "Block edges")
    assert fillet["state"] == "warning"
    assert "reduced" in fillet["message"]
    assert facts["incomplete"] is False


def test_hole_variants(tmp_path):
    facts = run(tmp_path, script([
        'm.body("Base", shape="box", size=(100, 40, 10))',
        'm.hole("Bore", on=m.face("Base", "top"), at=(-30, 0, 10), diameter=5, extent="through", kind="counterbore", cb_diameter=9, cb_depth=3)',
        'm.hole("Sink", on=m.face("Base", "top"), at=(0, 0, 10), diameter=5, extent="through", kind="countersink", cs_diameter=10)',
        'm.hole("Blind", on=m.face("Base", "top"), at=(30, 0, 10), diameter=4, depth=6)',
        'm.hole("Huge", on=m.face("Base", "top"), diameter=150, depth=2)',
    ]))
    assert step(facts, "Bore")["created"] == ["counterbore_wall", "wall"]
    assert step(facts, "Sink")["created"] == ["countersink", "wall"]
    assert step(facts, "Blind")["created"] == ["floor", "wall"]
    huge = step(facts, "Huge")
    assert (huge["state"], huge["code"]) == ("failed", "too_large")
    removed = math.pi * (2.5**2 * 7 + 4.5**2 * 3) + math.pi * 2**2 * 6
    assert facts["volume_mm3"] < 100 * 40 * 10 - removed + 1


def test_extrude_combine_and_move(tmp_path):
    facts = run(tmp_path, script([
        'm.body("Base", shape="box", size=(100, 40, 10))',
        'm.extrude("Pocket", on=m.face("Base", "top"), profile="rectangle", width=20, length=10, distance=-3, operation="cut")',
        'm.extrude("Post", on=m.face("Base", "top"), profile="circle", diameter=6, at=(40, 0, 10), distance=8, operation="new")',
        'm.move("Lift", part=m.part("Post"), method="translate", by=(0, 0, 2))',
        'm.body("Plug", shape="box", size=(4, 4, 4), at=(-40, 0, 8))',
        'm.combine("Socket", target=m.part("Base"), tool=m.part("Plug"), operation="cut")',
        'm.body("Far", shape="box", size=(1, 1, 1), at=(500, 0, 0))',
        'm.combine("Miss", target=m.part("Base"), tool=m.part("Far"), operation="cut")',
    ]))
    assert [s["state"] for s in facts["steps"]][:6] == ["ok"] * 6, facts["steps"]
    assert step(facts, "Pocket")["created"] == ["end", "sides"]
    assert (step(facts, "Miss")["state"], step(facts, "Miss")["code"]) == ("failed", "missed_target")
    labels = [p["label"] for p in facts["parts"]]
    assert "Plug" not in labels and "Post" in labels
    post = next(p for p in facts["parts"] if p["label"] == "Post")
    assert post["volume_mm3"] == pytest.approx(math.pi * 9 * 8, rel=1e-3)
    assert facts["bounds"][2] == pytest.approx(20)


def test_move_align_puts_faces_together(tmp_path):
    facts = run(tmp_path, script([
        'm.body("Base", shape="box", size=(100, 40, 10))',
        'm.body("Figure", shape="cylinder", diameter=10, height=20, at=(0, 0, 50))',
        'm.move("Seat", part=m.part("Figure"), method="align", face=m.face("Figure", "bottom"), to=m.face("Base", "top"))',
    ]))
    assert states(facts)["Seat"] == "ok"
    assert facts["bounds"][2] == pytest.approx(30)


@needs_font
def test_text_engrave_depth(tmp_path):
    run(tmp_path, fixture())
    floors = [f for f in faces_in_step(tmp_path / "model-out")
              if f.geom_type == bd.GeomType.PLANE and abs(f.center().Y + 19.5) < 1e-6]
    assert floors
