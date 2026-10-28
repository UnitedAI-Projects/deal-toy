"""The Mantel name and diamond mark, modelled in Mantel's own CAD runtime.

The sign-in screen shows the GLB export of this model. Text is set in Inter Display Bold
(SIL Open Font License, see fonts/OFL.txt). Millimetres, Z up; the name stands in the XZ plane.
"""

from pathlib import Path

import build123d as bd

FONT = Path(__file__).parent / "fonts" / "InterDisplay-Bold.ttf"
PARAMS = {
    "TEXT_SIZE": {"value": 56.0, "unit": "mm", "part": "Name", "min": 20, "max": 120},
    "DEPTH": {"value": 22.0, "unit": "mm", "part": "Name", "min": 4, "max": 60},
    "MARK_SIZE": {"value": 48.0, "unit": "mm", "part": "Mark", "min": 20, "max": 100},
    "MARK_WALL": {"value": 6.0, "unit": "mm", "part": "Mark", "min": 2, "max": 20},
    "GAP": {"value": 14.0, "unit": "mm", "part": "Mark", "min": 0, "max": 60},
    "EDGE": {"value": 1.2, "unit": "mm", "part": "Name", "min": 0, "max": 3},
}


def value(name: str) -> float:
    return PARAMS[name]["value"]


def softened(solid: bd.Part, size: float) -> bd.Part:
    """Chamfers the front and back edges, which show when the name is spun around.

    All or nothing: if OCCT refuses a chamfer on any glyph corner, the part keeps sharp
    edges rather than mixing softened and sharp letters. Inter's letters currently stay sharp.
    """
    if size <= 0:
        return solid
    sides = solid.faces().group_by(bd.Axis.Y)
    edges = [
        e for group in (sides[0], sides[-1]) for face in group for e in face.edges()
    ]
    try:
        return bd.chamfer(edges, size)
    except ValueError:
        return solid


def build():
    depth = value("DEPTH")
    letters = bd.Text(
        "Mantel",
        font_size=value("TEXT_SIZE"),
        font_path=str(FONT),
        text_align=(bd.TextAlign.LEFT, bd.TextAlign.CENTER),
    )
    name = softened(
        bd.extrude(bd.Plane.XZ * letters, amount=depth / 2, both=True), value("EDGE")
    )
    name.label = "Name"

    size, wall = value("MARK_SIZE"), value("MARK_WALL")
    frame = bd.Rectangle(size, size) - bd.Rectangle(size - 2 * wall, size - 2 * wall)
    reach = size * 2**0.5 / 2
    placed = bd.Plane.XZ * bd.Pos(-(value("GAP") + reach), 0) * bd.Rot(0, 0, 45) * frame
    mark = softened(bd.extrude(placed, amount=depth / 2, both=True), value("EDGE"))
    mark.label = "Mark"
    return bd.Compound(children=[mark, name], label="Mantel name")
