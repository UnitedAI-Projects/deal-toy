"""Reference tea cup in the steps layout, built layer by layer from its design sheet.

Synthetic demonstration geometry in millimetres, Z up. Every part of the cup is a layer between the
mantel:steps markers, in the order of examples/tea_cup_design.json, and base() returns None.
"""
import mantel as mt

PARAMS = {
    "CUP_HEIGHT": {"value": 95.0, "unit": "mm", "part": "Cup wall", "min": 60, "max": 140},
    "RIM_DIAMETER": {"value": 84.0, "unit": "mm", "part": "Cup wall", "min": 60, "max": 110},
    "BASE_DIAMETER": {"value": 62.0, "unit": "mm", "part": "Cup wall", "min": 50, "max": 80},
    "WALL": {"value": 3.0, "unit": "mm", "part": "Cup wall", "min": 2, "max": 6},
}


def base():
    return None


def build():
    m = mt.Model(base(), params=PARAMS)
    # mantel:steps begin
    m.loft("Cup wall", sections=[{"shape": "circle", "z": 4, "diameter": mt.P("BASE_DIAMETER")}, {"shape": "circle", "z": mt.P("CUP_HEIGHT"), "diameter": mt.P("RIM_DIAMETER")}])
    m.shell("Hollow", target=m.part("Cup wall"), thickness=mt.P("WALL"), open=[m.face("Cup wall", "top")])
    m.revolve("Foot ring", profile=[(24, 0), (30, 0), (30, 4.5), (24, 4.5)], operation="join", target=m.part("Cup wall"))
    m.fillet("Rim", edges=m.edges("Cup wall", around="top"), radius=1.2)
    m.sweep("Handle", path=[(38, 0, 80), (56, 0, 76), (60, 0, 52), (52, 0, 32), (32.5, 0, 25)], diameter=8, target=m.part("Cup wall"))
    m.appearance("Glaze", target=m.part("Cup wall"), color=(0.96, 0.95, 0.92), finish="gloss")
    # mantel:steps end
    return m.result()
