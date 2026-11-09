"""The revolve, loft, sweep, shell and appearance actions, and the tea cup reference model."""
import math

from test_mantel import run, script, states, step

R, H, T = 40, 95, 3
CUP = f"[(0, 0), ({R}, 0), ({R}, {H}), ({R - T}, {H}), ({R - T}, {T}), (0, {T})]"
WALL = f'm.revolve("Cup wall", profile={CUP})'


# A model needs one part to build, so tests of failing steps add this one first.
SPARE = 'm.body("Spare", shape="box", size=(5, 5, 5), at=(300, 0, 0))'


def part(facts, label):
    return next(p for p in facts["parts"] if p["label"] == label)


def test_revolve_makes_a_cup_wall(tmp_path):
    facts = run(tmp_path, script([WALL]))
    assert states(facts) == {"Cup wall": "ok"}
    assert [p["label"] for p in facts["parts"]] == ["Cup wall"]
    expected = math.pi * R * R * T + math.pi * (R * R - (R - T) ** 2) * (H - T)
    assert abs(part(facts, "Cup wall")["volume_mm3"] - expected) / expected < 0.01


def test_revolve_profile_reads_params(tmp_path):
    def height(value):
        params = f'{{"CUP_H": {{"value": {value}, "unit": "mm", "min": 50, "max": 150}}}}'
        profile = '[(0, 0), (40, 0), (40, mt.P("CUP_H")), (37, mt.P("CUP_H")), (37, 3), (0, 3)]'
        facts = run(tmp_path, script([f'm.revolve("Cup wall", profile={profile})'], params=params),
                    name=f"h{value}")
        assert states(facts) == {"Cup wall": "ok"}
        return facts["bounds"][2]
    assert abs(height(110) - height(95) - 15) < 0.01


def test_revolve_join_needs_a_target(tmp_path):
    facts = run(tmp_path, script([SPARE, f'm.revolve("Ring", profile={CUP}, operation="join")']))
    assert step(facts, "Ring")["code"] == "invalid_input"


def test_loft_oval_to_round(tmp_path):
    sections = ('[{"shape": "circle", "z": 0, "diameter": 62}, '
                '{"shape": "ellipse", "z": 95, "width": 86, "length": 72}]')
    facts = run(tmp_path, script([f'm.loft("Body", sections={sections})']))
    assert states(facts) == {"Body": "ok"}
    size = facts["bounds"]
    assert abs(size[0] - 86) < 0.5 and abs(size[1] - 72) < 0.5 and abs(size[2] - 95) < 0.01


def test_loft_refuses_unordered_sections(tmp_path):
    sections = ('[{"shape": "circle", "z": 95, "diameter": 62}, '
                '{"shape": "circle", "z": 0, "diameter": 80}]')
    facts = run(tmp_path, script([SPARE, f'm.loft("Body", sections={sections})']))
    assert step(facts, "Body")["state"] == "failed"
    assert step(facts, "Body")["code"] == "invalid_input"


def test_loft_section_needs_its_sizes(tmp_path):
    sections = '[{"shape": "circle", "z": 0}, {"shape": "circle", "z": 10, "diameter": 20}]'
    facts = run(tmp_path, script([SPARE, f'm.loft("Body", sections={sections})']))
    assert step(facts, "Body")["code"] == "invalid_input"
    assert "diameter is required" in step(facts, "Body")["message"]


HANDLE = 'path=[(38, 0, 80), (60, 0, 72), (62, 0, 40), (38, 0, 25)], diameter=8'


def test_sweep_handle_joins_the_wall(tmp_path):
    alone = run(tmp_path, script([WALL]), name="alone")
    facts = run(tmp_path, script([WALL, f'm.sweep("Handle", {HANDLE}, target=m.part("Cup wall"))']))
    assert states(facts) == {"Cup wall": "ok", "Handle": "ok"}
    assert [p["label"] for p in facts["parts"]] == ["Cup wall"]
    assert part(facts, "Cup wall")["volume_mm3"] > part(alone, "Cup wall")["volume_mm3"]


def test_sweep_missing_the_target_fails(tmp_path):
    away = 'path=[(140, 0, 80), (160, 0, 72), (162, 0, 40), (140, 0, 25)], diameter=8'
    facts = run(tmp_path, script([WALL, f'm.sweep("Handle", {away}, target=m.part("Cup wall"))']))
    assert step(facts, "Handle")["state"] == "failed"
    assert step(facts, "Handle")["code"] == "missed_target"


def test_shell_hollows_with_open_top(tmp_path):
    facts = run(tmp_path, script([
        'm.body("Cup", shape="cylinder", diameter=60, height=60)',
        'm.shell("Hollow", target=m.part("Cup"), thickness=3, open=[m.face("Cup", "top")])',
    ]))
    assert states(facts) == {"Cup": "ok", "Hollow": "ok"}
    expected = math.pi * 30 ** 2 * 60 - math.pi * 27 ** 2 * 57
    assert abs(part(facts, "Cup")["volume_mm3"] - expected) / expected < 0.02


def test_shell_open_face_must_belong_to_the_target(tmp_path):
    facts = run(tmp_path, script([
        'm.body("Cup", shape="cylinder", diameter=60, height=60)',
        'm.body("Other", shape="box", size=(10, 10, 10), at=(100, 0, 0))',
        'm.shell("Hollow", target=m.part("Cup"), thickness=3, open=[m.face("Other", "top")])',
    ]))
    assert step(facts, "Hollow")["code"] == "face_not_found"


def test_appearance_survives_later_cuts(tmp_path):
    facts = run(tmp_path, script([
        'm.body("Cup", shape="cylinder", diameter=60, height=60)',
        'm.appearance("Glaze", target=m.part("Cup"), color=(0.85, 0.65, 0.13), finish="gloss")',
        'm.hole("Drain", on=m.face("Cup", "bottom"), diameter=4, extent="through")',
    ]))
    assert states(facts) == {"Cup": "ok", "Glaze": "ok", "Drain": "ok"}
    cup = part(facts, "Cup")
    assert cup["color"] == [0.85, 0.65, 0.13]
    assert cup["finish"] == "gloss"
    assert (tmp_path / "model-out" / "model.glb").stat().st_size > 0


def test_parts_without_appearance_have_no_colour(tmp_path):
    facts = run(tmp_path, script(['m.body("Cup", shape="cylinder", diameter=60, height=60)']))
    assert "color" not in part(facts, "Cup") and "finish" not in part(facts, "Cup")


def test_appearance_unknown_part_fails(tmp_path):
    facts = run(tmp_path, script([SPARE, 'm.appearance("Glaze", target=m.part("Cup"), color=(1, 1, 1))']))
    assert step(facts, "Glaze")["code"] == "part_not_found"
