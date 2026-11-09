"""Dimensioned drawing of a build's persisted STEP: blueprint.dxf + blueprint.pdf.

Runs in the job container and imports no model code. Views, dimension values and hole callouts are
read from the solid, so the sheet cannot disagree with the STEP. The panel beside the views prints
what the build's inspection measured, passed in the spec. It is a draft for review; tolerances come
from the manufacturing brief and are stated as open here.
"""
import json
import math
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).with_name("lib")))
import build123d as bd
import ezdxf
import matplotlib
from ezdxf import units
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.config import BackgroundPolicy, Configuration
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from ezdxf.enums import TextEntityAlignment
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCP.HLRAlgo import HLRAlgo_Projector
from OCP.HLRBRep import HLRBRep_PolyAlgo, HLRBRep_PolyHLRToShape
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from runner import limits

matplotlib.use("Agg")
import matplotlib.pyplot as plt

PAPER = ("A3", 420.0, 297.0)
ENLARGEMENTS = (10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50)  # paper mm per model mm
BORDER = 10.0
TITLE_HEIGHT = 46.0
VIEW_GAP = 34.0  # paper mm between views, room for one row of dimensions and a label
VIEW_MARGIN = 30.0  # paper mm kept around the view group
DIM_OFFSET = 12.0
MAX_HIDDEN_EDGES = 6000
MAX_CENTER_MARKS = 60
MAX_CIRCLE_SIZES = 6
PANEL_WIDTH = 130.0
PANEL_ROW = 4.4
FAR = 100000.0
FONT = "MANTEL"
LAYERS = {  # name: (ACI color, linetype, lineweight in 1/100 mm)
    "OUTLINE": (7, "Continuous", 35),
    "HIDDEN": (8, "HIDDEN", 18),
    "CENTER": (1, "CENTER", 18),
    "DIMENSIONS": (5, "Continuous", 18),
    "TEXT": (7, "Continuous", 25),
    "TITLEBLOCK": (7, "Continuous", 35),
    "VIEWPORTS": (8, "Continuous", 13),
}
VIEWS = {  # third-angle: camera, up, and the world axes that become (u, v), with the view axis
    "front": ((0, -FAR, 0), (0, 0, 1), (0, 2), 1),
    "top": ((0, 0, FAR), (0, 1, 0), (0, 1), 2),
    "right": ((FAR, 0, 0), (0, 0, 1), (1, 2), 0),
}


def choose_enlargement(width: float, depth: float, height: float, panel: float = 0.0) -> float:
    """Largest standard scale at which the three views and their dimensions fit beside the panel."""
    _, paper_w, paper_h = PAPER
    room_w = paper_w - 2 * BORDER - VIEW_GAP - 2 * VIEW_MARGIN - panel
    room_h = paper_h - 2 * BORDER - TITLE_HEIGHT - VIEW_GAP - 2 * VIEW_MARGIN
    for factor in ENLARGEMENTS:
        if (width + depth) * factor <= room_w and (height + depth) * factor <= room_h:
            return factor
    raise ValueError("Model is too large for the sheet")


def scale_label(factor: float) -> str:
    return f"{factor:g}:1" if factor >= 1 else f"1:{round(1 / factor)}"


def clean(value, limit: int, fallback: str) -> str:
    """Title-block text comes from project names: printable, one line, bounded."""
    text = re.sub(r"[^\x20-\x7e]", " ", str(value)).strip() if value is not None else ""
    return text[:limit] or fallback


def mm(value) -> str:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("not a measurement")
    return f"{number:.2f}"


def span(box: dict, axis: int) -> str:
    return f"{mm(box['min'][axis])} to {mm(box['max'][axis])}"


def _rows(items, make) -> list:
    """A row that cannot be read is left off: the sheet prints only what was measured."""
    rows = []
    for item in items if isinstance(items, list) else []:
        try:
            rows.append(make(item))
        except (AttributeError, IndexError, KeyError, TypeError, ValueError):
            continue
    return rows


def panel_sections(spec: dict) -> list:
    """Tables for the panel, as (title, ((heading, x in paper mm), ...), rows). Empty ones are left out."""
    materials = _rows(spec.get("materials"), lambda m: (clean(m["part"], 24, "-"), clean(m["name"], 60, "-")))

    def dimension(item):
        return clean(item["name"], 70, "-"), mm(item["value"]) + ("" if item.get("matches", True) else " CHECK")

    def hole(item):
        at = ", ".join(mm(v) for v in item["at"][:3])
        return (clean(item["part"], 16, "-"), mm(item["diameter"]),
                mm(item["depth"]) + (" BLIND" if item.get("blind") else ""), at)

    def extent(item):
        return (clean(item["name"], 26, "-"), span(item["bbox"], 0), span(item["bbox"], 1), span(item["bbox"], 2))

    holes = [(f"H{i + 1}", *row) for i, row in enumerate(_rows(spec.get("holes"), hole))]
    sections = (
        ("MATERIALS", (("PART", 0), ("MATERIAL", 38)), materials),
        ("FEATURE DIMENSIONS", (("NAME", 0), ("MM", 100)), _rows(spec.get("dimensions"), dimension)),
        ("HOLES", (("ID", 0), ("PART", 9), ("DIA", 36), ("DEPTH", 50), ("START X, Y, Z", 76)), holes),
        ("TEXT EXTENTS", (("TEXT", 0), ("X", 40), ("Y", 70), ("Z", 98)), _rows(spec.get("text"), extent)),
    )
    return [section for section in sections if section[2]]


def _edges(compound) -> list:
    found = []
    if compound.IsNull():
        return found
    explorer = TopExp_Explorer(compound, TopAbs_EDGE)
    while explorer.More():
        found.append(bd.Edge(explorer.Current()))
        explorer.Next()
    return found


def project(shape, view: str, deflection: float) -> tuple[list, list]:
    """Visible and hidden polylines from OCC's polygonal HLR, in (u, v). The exact HLR drops most
    silhouette curves of lofted surfaces, and those silhouettes are the outline of a deal toy."""
    camera, up, _, _ = VIEWS[view]
    BRepMesh_IncrementalMesh(shape.wrapped, deflection, False, 0.2, True)
    algo = HLRBRep_PolyAlgo()
    algo.Load(shape.wrapped)
    axes = gp_Ax2(gp_Pnt(*camera), gp_Dir(*camera))
    axes.SetYDirection(gp_Dir(*up))
    algo.Projector(HLRAlgo_Projector(axes))
    algo.Update()
    hlr = HLRBRep_PolyHLRToShape()
    hlr.Update(algo)

    def lines(edges):
        # Polygonal HLR returns straight segments, some too short to evaluate along their length.
        segments = ([(v.X, v.Y) for v in e.vertices()] for e in edges)
        return [s for s in segments if len(s) == 2]

    return (lines(_edges(hlr.VCompound()) + _edges(hlr.OutLineVCompound())),
            lines(_edges(hlr.HCompound()) + _edges(hlr.OutLineHCompound())))


def holes(shape, view: str) -> list:
    """Full circles facing this view as (u, v, radius), largest first, one per centre so that
    concentric edges (a wheel, a counterbore) count once."""
    _, _, (a, b), axis = VIEWS[view]
    found = {}
    for edge in shape.edges().filter_by(bd.GeomType.CIRCLE):
        if not edge.is_closed or abs(abs(tuple(edge.normal())[axis]) - 1) > 1e-6:
            continue
        center = tuple(edge.arc_center)
        found[(round(center[a], 3), round(center[b], 3), round(edge.radius, 3))] = True
    largest = {}
    for u, v, radius in sorted(found, key=lambda h: h[2]):
        largest[(u, v)] = radius
    return sorted(((u, v, r) for (u, v), r in largest.items()), key=lambda h: -h[2])


def draw(step: Path, spec: dict, destination: Path) -> dict:
    shape = bd.import_step(step)
    box = shape.bounding_box()
    lows, size = tuple(box.min), tuple(box.size)
    width, depth, height = size
    sections = panel_sections(spec)
    panel = PANEL_WIDTH if sections else 0.0
    factor = choose_enlargement(width, depth, height, panel)
    scale = 1 / factor
    gap = VIEW_GAP * scale
    offset = DIM_OFFSET * scale
    deflection = max(max(size) / 4000, 0.005)
    title = clean(spec.get("title"), 60, "Untitled model")
    revision = clean(spec.get("revision"), 20, "-")
    date = datetime.now(UTC).date().isoformat()

    doc = ezdxf.new("R2010", setup=True)
    doc.units = units.MM
    doc.header["$INSUNITS"] = units.MM
    doc.header["$MEASUREMENT"] = 1
    doc.styles.add(FONT, font="LiberationSans-Regular.ttf")
    for name, (color, linetype, weight) in LAYERS.items():
        doc.layers.add(name, color=color, linetype=linetype, lineweight=weight)
    msp = doc.modelspace()
    override = {"dimscale": scale, "dimtxt": 3.0, "dimasz": 2.5, "dimexo": 1.0, "dimexe": 1.5, "dimgap": 0.8,
                "dimdec": 2, "dimzin": 8, "dimlfac": 1.0, "dimclrd": 5, "dimclre": 5, "dimclrt": 5, "dimtad": 1, "dimjust": 0,
                "dimtxsty": FONT}
    attrs = {"layer": "DIMENSIONS"}
    placed = {"front": (0.0, 0.0), "top": (0.0, height + gap), "right": (width + gap, 0.0)}
    drawn, hidden_omitted = {}, False
    for view, (x, y) in placed.items():
        _, _, (a, b), _ = VIEWS[view]
        ox, oy = x - lows[a], y - lows[b]
        visible, hidden = project(shape, view, deflection)
        if len(hidden) > MAX_HIDDEN_EDGES:
            hidden, hidden_omitted = [], True
        for layer, lines in (("OUTLINE", visible), ("HIDDEN", hidden)):
            for line in lines:
                msp.add_lwpolyline([(u + ox, v + oy) for u, v in line],
                                   dxfattribs={"layer": layer, "ltscale": scale})
        drawn[view] = [(u + ox, v + oy) for line in visible for u, v in line]

    def extreme(view, axis, pick):
        return pick(drawn[view], key=lambda q: q[axis])

    def linear(p1, p2, base, angle):
        msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle, override=override, dxfattribs=attrs).render()

    def label(text, x, y):
        msp.add_text(text, height=3.5 * scale, dxfattribs={"layer": "TEXT", "style": FONT}).set_placement(
            (x, y), align=TextEntityAlignment.MIDDLE_CENTER)

    # Overall dimensions are measured between the extreme points of the drawn geometry.
    linear(extreme("front", 0, min), extreme("front", 0, max), (0, -offset), 0)
    linear(extreme("front", 1, min), extreme("front", 1, max), (-offset, 0), 90)
    right_x = placed["right"][0]
    linear(extreme("right", 0, min), extreme("right", 0, max), (right_x, -offset), 0)
    label("FRONT", width / 2, -offset * 2)
    label("RIGHT", right_x + depth / 2, -offset * 2)
    label("TOP", width / 2, placed["top"][1] + depth + offset)

    # Centre marks on the views; diameters go in the notes, where they cannot collide with geometry.
    sizes = {}
    for view, (x, y) in placed.items():
        _, _, (a, b), _ = VIEWS[view]
        circles = holes(shape, view)
        for _, _, radius in circles:
            sizes[radius] = sizes.get(radius, 0) + 1
        for u, v, radius in circles[:MAX_CENTER_MARKS]:
            cu, cv = u - lows[a] + x, v - lows[b] + y
            mark = radius * 1.2
            for start, end in (((cu - mark, cv), (cu + mark, cv)), ((cu, cv - mark), (cu, cv + mark))):
                msp.add_line(start, end, dxfattribs={"layer": "CENTER", "ltscale": scale})

    paper, paper_w, paper_h = PAPER
    sheet = doc.layouts.new(paper)
    sheet.page_setup(size=(paper_w, paper_h), margins=(0, 0, 0, 0), units="mm", scale=1)
    area = (BORDER, BORDER + TITLE_HEIGHT, paper_w - BORDER - panel, paper_h - BORDER)
    area_w, area_h = area[2] - area[0], area[3] - area[1]
    sheet.add_viewport(center=((area[0] + area[2]) / 2, (area[1] + area[3]) / 2), size=(area_w, area_h),
                       view_center_point=((width + gap + depth) / 2, (height + gap + depth) / 2),
                       view_height=area_h * scale, dxfattribs={"layer": "VIEWPORTS"})

    def text(value, x, y, h=2.5, layer="TEXT"):
        sheet.add_text(value, height=h, dxfattribs={"layer": layer, "style": FONT}).set_placement(
            (x, y), align=TextEntityAlignment.LEFT)

    def rule(start, end):
        sheet.add_line(start, end, dxfattribs={"layer": "TITLEBLOCK"})

    def frame(x0, y0, x1, y1):
        sheet.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={"layer": "TITLEBLOCK"})

    frame(BORDER, BORDER, paper_w - BORDER, paper_h - BORDER)
    rule((BORDER, BORDER + TITLE_HEIGHT), (paper_w - BORDER, BORDER + TITLE_HEIGHT))
    block_x = paper_w - BORDER - 150
    rule((block_x, BORDER), (block_x, BORDER + TITLE_HEIGHT))
    rows = [("TITLE", title), ("PROJECT", clean(spec.get("project"), 60, "-")), ("REVISION", revision), ("DATE", date),
            ("SCALE", f"{scale_label(factor)} ON {paper}"),
            ("UNITS", "MM - DO NOT SCALE DRAWING"), ("PROJECTION", "THIRD ANGLE")]
    row_h = TITLE_HEIGHT / len(rows)
    rule((block_x + 26, BORDER), (block_x + 26, BORDER + TITLE_HEIGHT))
    for i, (key, value) in enumerate(rows):
        y = BORDER + TITLE_HEIGHT - (i + 1) * row_h
        if i:
            rule((block_x, y + row_h), (paper_w - BORDER, y + row_h))
        text(key, block_x + 2, y + 2.2, 2.2, "TITLEBLOCK")
        text(value, block_x + 28, y + 2.2, 2.5, "TITLEBLOCK")
    if sections:
        panel_x = paper_w - BORDER - panel
        rule((panel_x, BORDER + TITLE_HEIGHT), (panel_x, paper_h - BORDER))
        y = paper_h - BORDER - 6
        floor = BORDER + TITLE_HEIGHT + 2 * PANEL_ROW
        text("ALL VALUES IN MM, MEASURED FROM THE BUILD", panel_x + 3, y, 2.4)
        y -= 1.5 * PANEL_ROW
        omitted = 0
        for heading, columns, table in sections:
            room = int((y - floor) / PANEL_ROW) - 2
            shown = table[:max(room, 0)]
            omitted += len(table) - len(shown)
            if not shown:
                continue
            text(heading, panel_x + 3, y, 2.8)
            y -= PANEL_ROW
            for name, column in columns:
                text(name, panel_x + 3 + column, y, 2.0, "TITLEBLOCK")
            y -= PANEL_ROW
            for row in shown:
                for value, (_, column) in zip(row, columns, strict=True):
                    text(value, panel_x + 3 + column, y, 2.2)
                y -= PANEL_ROW
            y -= 0.5 * PANEL_ROW
        if omitted:
            text(f"{omitted} MORE ROWS DO NOT FIT. SEE INSPECT.JSON.", panel_x + 3, floor - PANEL_ROW, 2.4)
    listed_materials = any(section[0] == "MATERIALS" for section in sections)
    notes = [
        "NOTES",
        f"1. OVERALL {width:.2f} W x {depth:.2f} D x {height:.2f} H MM, MEASURED FROM THE SOLID.",
        "2. TOLERANCES NOT SPECIFIED. SEE THE MANUFACTURING BRIEF." if listed_materials else
        "2. TOLERANCES AND MATERIAL NOT SPECIFIED. SEE THE MANUFACTURING BRIEF.",
        "3. DRAFT DERIVED FROM THE MODEL. NOT REVIEWED OR APPROVED FOR MANUFACTURE.",
    ]
    if sizes:
        largest = sorted(sizes.items(), reverse=True)[:MAX_CIRCLE_SIZES]
        more = " AND SMALLER" if len(sizes) > MAX_CIRCLE_SIZES else ""
        listed = ", ".join(f"DIA {2 * r:g} x{n}" for r, n in largest)
        notes.append(f"{len(notes)}. CIRCULAR FEATURES AS MARKED: {listed}{more}.")
    if hidden_omitted:
        notes.append(f"{len(notes)}. HIDDEN LINES OMITTED: THIS MODEL HAS TOO MANY FOR A LEGIBLE SHEET.")
    for i, note in enumerate(notes):
        text(note, BORDER + 3, BORDER + TITLE_HEIGHT - 7 - i * 7, 3.0 if i == 0 else 2.4)

    destination.mkdir(exist_ok=True)
    auditor = doc.audit()
    if auditor.has_errors:
        raise ValueError(f"Drawing failed its DXF audit: {auditor.errors[:3]}")
    doc.saveas(destination / "blueprint.dxf")

    figure = plt.figure(figsize=(paper_w / 25.4, paper_h / 25.4))
    axes = figure.add_axes([0, 0, 1, 1])
    config = Configuration(background_policy=BackgroundPolicy.WHITE, lineweight_scaling=1.0)
    Frontend(RenderContext(doc), MatplotlibBackend(axes), config=config).draw_layout(sheet, finalize=True)
    figure.set_size_inches(paper_w / 25.4, paper_h / 25.4)  # the frontend resizes the figure to its content
    axes.set_position([0, 0, 1, 1])
    axes.set_xlim(0, paper_w)
    axes.set_ylim(0, paper_h)
    axes.set_aspect("equal")
    figure.savefig(destination / "blueprint.pdf")
    if spec.get("png"):  # local review of the sheet; the service does not ship it
        figure.savefig(destination / "blueprint.png", dpi=150)
    plt.close(figure)
    return {"scale": scale_label(factor), "paper": paper, "circle_sizes": len(sizes),
            "hidden_omitted": hidden_omitted, "bounds": size}


if __name__ == "__main__":
    limits()
    draw(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()), Path(sys.argv[3]))
