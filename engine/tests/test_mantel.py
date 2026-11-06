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
