import json
import struct
import sys
import threading
from pathlib import Path

import build123d as bd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runner import build
from service import Handler, HTTPServer, execute


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


def test_params_and_labelled_parts_reach_the_facts(tmp_path):
    source = tmp_path / "model.py"
    source.write_text(
        "import build123d as bd\n"
        "PARAMS = {'WIDTH': {'value': 20, 'unit': 'mm', 'part': 'Base', 'min': 5, 'note': 'x'}}\n"
        "def build():\n"
        "    base = bd.Box(PARAMS['WIDTH']['value'], 10, 2); base.label = 'Base'\n"
        "    post = bd.Pos(0, 0, 5) * bd.Box(2, 2, 8); post.label = 'Post'\n"
        "    return bd.Compound(children=[base, post])\n")
    facts = build(source, tmp_path / "out")
    assert facts["params"] == {"WIDTH": {"value": 20.0, "unit": "mm", "part": "Base", "min": 5.0}}
    assert [p["label"] for p in facts["parts"]] == ["Base", "Post"]
    assert facts["parts"][0]["volume_mm3"] == pytest.approx(400)
    glb = (tmp_path / "out" / "model.glb").read_bytes()
    assert b'"Base"' in glb and b'"Post"' in glb


def glb_triangles(path):
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    return sum(gltf["accessors"][primitive["indices"]]["count"] // 3
               for mesh in gltf["meshes"] for primitive in mesh["primitives"])


def test_exports_stay_compact(tmp_path):
    source = tmp_path / "model.py"
    source.write_text("import build123d as bd\n"
                      "def build():\n    return bd.extrude(bd.Text('Mantel 2026', 10.0), 1.0)\n")
    build(source, tmp_path / "out")
    # STEP readers rebuild surface curves from the 3D geometry; writing them doubles the file.
    assert b"PCURVE" not in (tmp_path / "out" / "model.step").read_bytes()
    # The viewer mesh is no finer than the STL mesh.
    stl_triangles = ((tmp_path / "out" / "model.stl").stat().st_size - 84) // 50
    assert glb_triangles(tmp_path / "out" / "model.glb") <= stl_triangles * 1.05


def test_invalid_params_fail_the_build(tmp_path):
    source = tmp_path / "model.py"
    source.write_text("import build123d as bd\nPARAMS = {'W': {'value': 'wide'}}\n"
                      "def build():\n    return bd.Box(1, 1, 1)\n")
    with pytest.raises(ValueError, match="numeric 'value'"):
        build(source, tmp_path / "out")


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


def test_http_startup_does_not_resolve_container_hostname(monkeypatch):
    def invalid_hostname(_host):
        raise UnicodeError("label too long")
    monkeypatch.setattr("socket.getfqdn", invalid_hostname)
    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        assert server.server_port > 0
        assert server.server_name == "cad"


@pytest.mark.skipif(sys.platform != "linux", reason="Linux RLIMIT_NPROC counts same-user threads")
def test_export_under_same_user_thread_pressure():
    # Hosted runners share the UID with other processes. The child's 64-task
    # limit must not strand OCCT waiting for exporter threads it cannot create.
    stop = threading.Event()
    threads = [threading.Thread(target=stop.wait, daemon=True) for _ in range(64)]
    try:
        for thread in threads:
            thread.start()
        result = execute("import build123d as bd\ndef build():\n    return bd.Box(10, 20, 30)\n")
        assert {a["name"] for a in result["artifacts"]} == {
            "model.step", "model.stl", "model.glb", "facts.json"}
    finally:
        stop.set()
        for thread in threads:
            if thread.ident is not None:
                thread.join(timeout=5)
