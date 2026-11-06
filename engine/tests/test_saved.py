import base64
import json
import sys
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ENGINE), str(ENGINE / "lib"), str(ENGINE / "tests")]
import mantel
from mantel.schema import check_object
from runner import build
from service import execute

NOTCH = '''import build123d as bd
import mantel as mt


@mt.action(
    id="finger-notch",
    summary="Cut a rounded finger notch into a face so a lid can be lifted.",
    inputs={"on": mt.Face("Face the notch opens onto"),
            "width": mt.Length("Notch width", min=8, max=40),
            "depth": mt.Length("How far the notch cuts in", min=1, max=10, default=3)},
    creates={"notch": "The curved notch face"},
    example='m.custom("Lid notch", action="finger-notch@1", on=m.face("Lid", "front"), width=18)',
)
def finger_notch(m, on, width, depth):
    """Use on the front edge of a lid or drawer. Not for holes: use the hole action."""
    label, faces = m.resolve_faces(on)
    plane = mt.plane_of(faces)
    before = m.parts[label]
    tool = bd.Plane(origin=plane.origin, x_dir=plane.x_dir, z_dir=plane.z_dir).location * bd.Cylinder(width / 2, depth * 2)
    m.parts[label] = before - tool
    return {"notch": [f for f in m.parts[label].faces() if f.geom_type == bd.GeomType.CYLINDER]}
'''

LID = '''import build123d as bd
import mantel as mt

PARAMS = {}


def base():
    return None


def build():
    m = mt.Model(base(), params=PARAMS)
    # mantel:steps begin
    m.body("Lid", shape="box", size=(60, 40, 10))
%s
    # mantel:steps end
    return m.result()
'''


def model(tmp_path, steps=""):
    path = tmp_path / "model.py"
    path.write_text(LID % steps)
    return path


def saved_dir(tmp_path, modules):
    directory = tmp_path / "saved"
    directory.mkdir()
    for key, source in modules.items():
        (directory / f"{key}.py").write_text(source)
    return directory


def test_decorator_builds_a_catalog_record(tmp_path):
    mantel.reset_saved()
    mantel.load_saved(saved_dir(tmp_path, {"finger-notch@1": NOTCH}))
    record = mantel.saved_record("finger-notch@1")
    assert record["id"] == "finger-notch@1"
    assert record["category"] == "Custom"
    assert record["description"].startswith("Use on the front edge")
    assert record["inputs"]["required"] == ["on", "width"]
    assert record["inputs"]["properties"]["width"] == {
        "type": "number", "description": "Notch width", "unit": "mm", "minimum": 8, "maximum": 40}
    assert record["inputs"]["properties"]["on"] == {"x-ref": "face", "description": "Face the notch opens onto"}
    assert record["selections"] == [{"input": "on", "kind": "face", "min": 1, "max": 1}]
    assert {f["code"] for f in record["failures"]} >= {"face_not_found", "ambiguous_reference", "invalid_input"}
    assert mantel.record_errors(record) == []
    # The record's schema is checked by the same validator as the built-in catalog.
    checked = check_object(record["inputs"], {"on": mantel.refs.FaceRef("Lid", "front"), "width": 10})
    assert checked["depth"] == 3
    with pytest.raises(mantel.schema.InvalidInput, match="width must be at most 40 mm"):
        check_object(record["inputs"], {"on": mantel.refs.FaceRef("Lid", "front"), "width": 50})


def test_saved_action_runs_as_a_step(tmp_path):
    path = model(tmp_path, '    m.custom("Notch", action="finger-notch@1", on=m.face("Lid", "front"), width=18)')
    facts = build(path, tmp_path / "out", modules=saved_dir(tmp_path, {"finger-notch@1": NOTCH}))
    notch = facts["steps"][1]
    assert (notch["state"], notch["created"]) == ("ok", ["notch"]), notch
    assert facts["volume_mm3"] < 60 * 40 * 10


def test_unknown_saved_action_fails_the_step(tmp_path):
    path = model(tmp_path, '    m.custom("Notch", action="finger-notch@2", on=m.face("Lid", "front"), width=18)')
    facts = build(path, tmp_path / "out", modules=saved_dir(tmp_path, {"finger-notch@1": NOTCH}))
    assert (facts["steps"][1]["state"], facts["steps"][1]["code"]) == ("failed", "action_not_found")


def test_fn_and_action_are_exclusive(tmp_path):
    extra = 'def f(m):\n    return None\n'
    source = (LID % '    m.custom("Both", fn=f, action="finger-notch@1")\n    m.custom("Neither")').replace(
        "PARAMS = {}", "PARAMS = {}\n\n" + extra)
    path = tmp_path / "model.py"
    path.write_text(source)
    facts = build(path, tmp_path / "out")
    assert [s["code"] for s in facts["steps"][1:]] == ["invalid_input", "invalid_input"]


def test_saved_inputs_are_validated(tmp_path):
    path = model(tmp_path, '    m.custom("Notch", action="finger-notch@1", on=m.face("Lid", "front"), width=500)')
    facts = build(path, tmp_path / "out", modules=saved_dir(tmp_path, {"finger-notch@1": NOTCH}))
    step = facts["steps"][1]
    assert (step["state"], step["code"]) == ("failed", "invalid_input")
    assert "width" in step["message"]


def test_check_mode_runs_the_example(tmp_path):
    path = model(tmp_path)
    facts = build(path, tmp_path / "out", modules=saved_dir(tmp_path, {"finger-notch@3": NOTCH}),
                  check="finger-notch@3")
    check = facts["check"]
    assert "error" not in check, check
    assert check["record"]["id"] == "finger-notch@3"
    assert (check["step"]["name"], check["step"]["state"], check["step"]["created"]) == ("Lid notch", "ok", ["notch"])


@pytest.mark.parametrize(("change", "message"), [
    (lambda s: s.replace("Cut a rounded finger notch into a face so a lid can be lifted.", "x" * 130), "summary"),
    (lambda s: s.replace('mt.Length("Notch width", min=8, max=40)', 'mt.Length("", min=8, max=40)'), "width"),
    (lambda s: s.replace("@mt.action(", "_unused = dict(", 1), "decorator"),
    (lambda s: s + "\ndef broken(:\n", "SyntaxError"),
    (lambda s: s.replace('action="finger-notch@1"', 'action="other@1"'), "example"),
])
def test_check_reports_bad_records(tmp_path, change, message):
    facts = build(model(tmp_path), tmp_path / "out", modules=saved_dir(tmp_path, {"finger-notch@1": change(NOTCH)}),
                  check="finger-notch@1")
    assert message in facts["check"]["error"]
    assert "step" not in facts["check"]
    assert facts["steps"][0]["state"] == "ok"


def test_service_writes_modules_read_only():
    writer = NOTCH.replace('    label, faces = m.resolve_faces(on)',
                           '    open(__file__ + ".tmp", "w").write("x")\n    label, faces = m.resolve_faces(on)')
    source = LID % '    m.custom("Notch", action="finger-notch@1", on=m.face("Lid", "front"), width=18)'
    result = execute(source, modules={"finger-notch@1": writer})
    facts = json.loads(base64.b64decode(result["artifacts"][3]["base64"]))
    assert (facts["steps"][1]["state"], facts["steps"][1]["code"]) == ("failed", "internal_error")
    ok = execute(source, modules={"finger-notch@1": NOTCH})
    assert json.loads(base64.b64decode(ok["artifacts"][3]["base64"]))["steps"][1]["state"] == "ok"


def test_service_rejects_bad_modules():
    with pytest.raises(ValueError, match="module"):
        execute("def build():\n    return 1\n", modules={"Bad Key": "x"})
    with pytest.raises(ValueError, match="check"):
        execute("def build():\n    return 1\n", modules={}, check="finger-notch@1")


ROOT = ENGINE.parent


@pytest.mark.skipif(not __import__("test_mantel").has_font(), reason="Liberation Sans is installed in the build image and CI only")
def test_example_action_checks(tmp_path):
    example = (ROOT / "examples/saved_actions/finger_notch.py").read_text()
    facts = build(ROOT / "examples/deal_toy_steps.py", tmp_path / "out",
                  modules=saved_dir(tmp_path, {"finger-notch@1": example}), check="finger-notch@1")
    check = facts["check"]
    assert "error" not in check, check
    assert (check["step"]["state"], check["step"]["created"]) == ("ok", ["notch"])
