"""Reference deal-toy model in the standard steps layout, used by engine and Worker tests."""
import build123d as bd
import mantel as mt

PARAMS = {
    "BLOCK_W": {"value": 80.0, "unit": "mm", "part": "Block", "min": 40, "max": 150},
    "HOLE_D": {"value": 5.0, "unit": "mm", "part": "Base", "min": 2, "max": 10},
    "HOLE_X": {"value": 20.0, "unit": "mm", "part": "Base", "min": 10, "max": 40},
}
BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)


def base():
    plinth = bd.Box(100, 40, 10, align=BOTTOM)
    plinth.label = "Base"
    coin = bd.Pos(0, 0, 30) * bd.Cylinder(15, 3, align=BOTTOM)
    coin.label = "Coin"
    return bd.Compound(children=[plinth, coin])


def build():
    m = mt.Model(base(), params=PARAMS)
    # mantel:steps begin
    m.body("Block", shape="box", size=(mt.P("BLOCK_W"), 40, 60), on=m.face("Base", "top"))
    m.plane("Mid plane", method="midplane", between=[m.face("Block", "left"), m.face("Block", "right")])
    m.hole("Mount hole", on=m.face("Base", "bottom"), at=(-30, 0, 0), diameter=mt.P("HOLE_D"), extent="through")
    m.hole("Mount hole 2", on=m.face("Base", "bottom"), at=(mt.P("HOLE_X"), 0, 0), diameter=mt.P("HOLE_D"), extent="through")
    m.text("Deal text", on=m.face("Base", "front"), text="ACME × GLOBEX", height=6, depth=0.5)
    m.combine("Coin cavity", target=m.part("Block"), tool=m.part("Coin"), operation="cut", keep_tool=True)
    m.fillet("Block edges", edges=m.edges("Block", around="top"), radius=2)
    # mantel:steps end
    return m.result()
