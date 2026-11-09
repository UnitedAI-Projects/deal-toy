"""Inspection fixture: the injection-moulded enclosure from the published copilot test, with its faults.

The ribs run into the screw bosses (they end on the boss axes), no wall has draft, and the cover's
lip sits only 0.30 mm from the housing wall. Synthetic geometry for engine and Worker tests; not a
customer design.
"""
import build123d as bd

PARAMS = {
    "WALL_T": {"value": 2.0, "unit": "mm", "part": "Housing", "min": 1, "max": 4},
    "LIP_GAP": {"value": 0.3, "unit": "mm", "part": "Cover", "min": 0.1, "max": 1},
}
PULL = {"Housing": (0, 0, 1)}
BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)
LENGTH, WIDTH, HEIGHT, FLOOR = 80.0, 60.0, 30.0, 2.0
BOSS_X, BOSS_Y, BOSS_R = 32.0, 22.0, 4.0


def build():
    wall = PARAMS["WALL_T"]["value"]
    gap = PARAMS["LIP_GAP"]["value"]
    housing = bd.Box(LENGTH, WIDTH, HEIGHT, align=BOTTOM)
    housing -= bd.Pos(0, 0, FLOOR) * bd.Box(LENGTH - 2 * wall, WIDTH - 2 * wall, HEIGHT, align=BOTTOM)
    for x in (-BOSS_X, BOSS_X):
        for y in (-BOSS_Y, BOSS_Y):
            housing += bd.Pos(x, y, FLOOR) * bd.Cylinder(BOSS_R, HEIGHT - FLOOR - 2, align=BOTTOM)
            housing -= bd.Pos(x, y, 14) * bd.Cylinder(1.25, HEIGHT, align=BOTTOM)
    housing.label = "Housing"
    # The fault: each rib ends on a boss axis instead of stopping at the boss wall.
    ribs = bd.Part() + [bd.Pos(0, y, FLOOR) * bd.Box(2 * BOSS_X, 1.5, 10, align=BOTTOM) for y in (-BOSS_Y, BOSS_Y)]
    ribs.label = "Ribs"
    inner_l, inner_w = LENGTH - 2 * wall, WIDTH - 2 * wall
    cover = bd.Pos(0, 0, HEIGHT) * bd.Box(LENGTH, WIDTH, 2, align=BOTTOM)
    lip = bd.Box(inner_l - 2 * gap, inner_w - 2 * gap, 3, align=BOTTOM)
    lip -= bd.Box(inner_l - 2 * gap - 3, inner_w - 2 * gap - 3, 3, align=BOTTOM)
    cover += bd.Pos(0, 0, HEIGHT - 3) * lip
    cover.label = "Cover"
    return bd.Compound(children=[housing, ribs, cover])


def dimensions(shape):
    housing, _, cover = shape.children
    x_faces = housing.faces().filter_by(bd.Axis.X)
    outer = max(x_faces, key=lambda f: f.center().X)
    inner = max((f for f in x_faces if f.center().X < LENGTH / 2 - 1e-6 and f.center().X > 0),
                key=lambda f: f.center().X)
    lip = max((f for f in cover.faces().filter_by(bd.Axis.X) if f.center().Z < HEIGHT),
              key=lambda f: f.center().X)
    return [
        {"name": "Wall thickness", "param": "WALL_T", "between": (inner, outer), "moves": inner},
        {"name": "Lip clearance", "param": "LIP_GAP", "between": (inner, lip), "moves": lip},
    ]
