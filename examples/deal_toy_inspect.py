"""Inspection fixture: a deal toy with deliberate faults, used by the engine and Worker tests.

A brass coin sits off-centre in a cast-acrylic block, only 1.5 mm behind the block's front face. The
block is tall for its base, so it tips at a modest angle. The engraving on the base is 0.3 mm deep
although ENGRAVE_D declares 0.5 mm. Synthetic geometry; not a customer design.
"""
import build123d as bd

PARAMS = {
    "BLOCK_H": {"value": 120.0, "unit": "mm", "part": "Block", "min": 40, "max": 200},
    "ENGRAVE_D": {"value": 0.5, "unit": "mm", "part": "Base", "min": 0.2, "max": 2},
}
MATERIALS = {
    "Base": {"name": "walnut", "density_g_cm3": 0.7},
    "Block": {"name": "cast acrylic", "density_g_cm3": 1.19},
    "Coin": {"name": "brass", "density_g_cm3": 8.5},
}
EMBEDS = [{"part": "Coin", "in": "Block"}]
BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)
ACTUAL_ENGRAVE = 0.3  # the fault: shallower than ENGRAVE_D


def build():
    base = bd.Box(100, 40, 10, align=BOTTOM)
    base = base - bd.Pos(0, -20 + ACTUAL_ENGRAVE / 2, 5) * bd.Box(40, ACTUAL_ENGRAVE, 6)
    base.label = "Base"
    block = bd.Pos(0, 0, 10) * bd.Box(60, 30, PARAMS["BLOCK_H"]["value"], align=BOTTOM)
    coin = bd.Pos(10, -12, 70) * bd.Rot(90, 0, 0) * bd.Cylinder(12, 3)
    block = block - coin
    block.label = "Block"
    coin.label = "Coin"
    return bd.Compound(children=[base, block, coin])


def dimensions(shape):
    base = shape.children[0]
    front = base.faces().filter_by(bd.Axis.Y).sort_by(bd.Axis.Y)[0]
    floor = next(f for f in base.faces().filter_by(bd.Axis.Y) if abs(f.center().Y - (-20 + ACTUAL_ENGRAVE)) < 1e-6)
    return [{"name": "Engraving depth", "param": "ENGRAVE_D", "between": (front, floor), "moves": floor}]
