"""Dimensioned drawing of a build's persisted STEP: blueprint.dxf + blueprint.pdf.

Runs in the job container and imports no model code. Views, dimension values and hole callouts are
read from the solid, so the sheets cannot disagree with the STEP. Sheet 1 is the whole toy, then one
sheet per part, then the lettering, letter by letter. Sheet 1 lives in model space at full size; the
detail sheets are drawn in paper space at the scale each one states, with dimensions that read true.
The panels print what the build's inspection measured, passed in the spec. It is a draft for review;
tolerances come from the manufacturing brief and are stated as open here.
"""
import itertools
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
from matplotlib.backends.backend_pdf import PdfPages
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
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
CHAIN_DIGITS = 6  # model mm; segment ends that agree to this many decimals are joined
COLLINEAR = 1e-6  # model mm off the line before a point is kept
MAX_CENTER_MARKS = 60
MAX_CIRCLE_SIZES = 6
PANEL_WIDTH = 130.0
PANEL_ROW = 4.4
MIN_BAND = 8.0  # paper mm; a narrower step dimension has no room for its number
MAX_BAND_EDGES = 8  # more distinct extents than this is lettering or detail, not a stack of parts
MIN_PICTORIAL = 0.3  # smallest fraction of sheet scale at which the isometric view is still useful
MAX_PART_SHEETS = 12
PART_GAP = 28.0  # paper mm between views on a part sheet: two rows of dimensions and a label
PART_LEFT = 36.0  # paper mm left of the front view for two rows of dimensions
PART_BELOW = 34.0  # paper mm under the front view for two rows of dimensions and a label
PART_ROW = 10.0  # paper mm between rows of dimensions on a part sheet
GLYPH_MIN_FACES = 3  # fewer coplanar shapes than this is not a line of lettering
GLYPH_MAX_SPAN = 0.3  # a letter is smaller than this fraction of its part
LINE_LEFT = 42.0  # paper mm left of a line of lettering, for its height dimension
LINE_MAX_HEIGHT = 40.0  # paper mm a line of lettering may be drawn at
LETTER_CELLS = 20  # letters per row of the letter table
LETTER_CELL = 18.0
LETTER_ROW = 3.4
LETTER_HEADS = ("#", "CH", "L", "B", "W", "H")
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
    "PICTORIAL": (7, "Continuous", 18),
    "HATCH": (8, "Continuous", 13),
    "LETTERING": (7, "Continuous", 18),
}
VIEWS = {  # third-angle: camera, up, and the world axes that become (u, v), with the view axis
    "front": ((0, -FAR, 0), (0, 0, 1), (0, 2), 1),
    "top": ((0, 0, FAR), (0, 1, 0), (0, 1), 2),
    "right": ((FAR, 0, 0), (0, 0, 1), (1, 2), 0),
    "iso": ((FAR, -FAR, FAR), (0, 0, 1), None, None),  # pictorial only: never dimensioned
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
    def material(item):
        volume = f"{float(mm(item['volume'])):,.0f}" if "volume" in item else "-"
        return (clean(item["part"], 20, "-"), clean(item["name"], 44, "-"), volume,
                mm(item["mass"]) if "mass" in item else "-")

    materials = _rows(spec.get("materials"), material)
    if len(materials) > 1 and all(row[3] != "-" for row in materials):
        materials.append(("TOTAL", "", "", mm(sum(float(row[3]) for row in materials))))

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
        ("MATERIALS", (("PART", 0), ("MATERIAL", 28), ("VOL MM3", 88), ("MASS G", 110)), materials),
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


def _straighten(path: list) -> list:
    """Drops points that lie on the straight line between their neighbours."""
    kept = [path[0]]
    for point, after in itertools.pairwise(path[1:]):
        (ax, ay), (bx, by), (cx, cy) = kept[-1], point, after
        run_x, run_y = cx - ax, cy - ay
        length = math.hypot(run_x, run_y)
        ahead = (bx - ax) * run_x + (by - ay) * run_y
        if length > 0 and abs((bx - ax) * run_y - (by - ay) * run_x) <= COLLINEAR * length and 0 < ahead < length * length:
            continue
        kept.append(point)
    kept.append(path[-1])
    return kept


def chain(segments: list) -> list:
    """Joins the two-point segments of the polygonal HLR end to end into polylines. Polygonal HLR
    returns one segment per mesh edge; written one entity each, a lettered model's sheet set runs
    to tens of megabytes. The geometry drawn is the same."""
    def key(point):
        return round(point[0], CHAIN_DIGITS), round(point[1], CHAIN_DIGITS)

    ends: dict = {}
    for index, (start, end) in enumerate(segments):
        ends.setdefault(key(start), []).append(index)
        ends.setdefault(key(end), []).append(index)
    used = [False] * len(segments)

    def extend(path):
        while True:
            here = key(path[-1])
            following = next((j for j in ends[here] if not used[j]), None)
            if following is None:
                return
            used[following] = True
            start, end = segments[following]
            path.append(end if key(start) == here else start)

    joined = []
    for index, (start, end) in enumerate(segments):
        if used[index]:
            continue
        used[index] = True
        path = [start, end]
        extend(path)
        path.reverse()
        extend(path)
        joined.append(_straighten(path))
    return joined


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


def bands(extents: list, smallest: float) -> list:
    """Spans between the solids' distinct extents along one axis, for a stack of parts. Each is a
    separate span, so one row never overlaps itself; those too narrow to label are left off."""
    edges = sorted({round(value, 3) for pair in extents for value in pair})
    if not 3 <= len(edges) <= MAX_BAND_EDGES:
        return []
    return [(low, high) for low, high in itertools.pairwise(edges) if high - low >= smallest]


class Page:
    """One A3 layout: the frame, title block, tables and notes every sheet shares."""

    def __init__(self, doc, name):
        _, paper_w, paper_h = PAPER
        self.doc, self.paper_w, self.paper_h = doc, paper_w, paper_h
        self.layout = doc.layouts.new(name)
        self.layout.page_setup(size=(paper_w, paper_h), margins=(0, 0, 0, 0), units="mm", scale=1)

    def text(self, value, x, y, h=2.5, layer="TEXT", align=TextEntityAlignment.LEFT):
        self.layout.add_text(value, height=h, dxfattribs={"layer": layer, "style": FONT}).set_placement((x, y), align=align)

    def rule(self, start, end, layer="TITLEBLOCK"):
        self.layout.add_line(start, end, dxfattribs={"layer": layer})

    def frame(self, x0, y0, x1, y1):
        self.layout.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={"layer": "TITLEBLOCK"})

    def title_block(self, rows):
        block_x = self.paper_w - BORDER - 150
        self.rule((block_x, BORDER), (block_x, BORDER + TITLE_HEIGHT))
        self.rule((BORDER, BORDER + TITLE_HEIGHT), (self.paper_w - BORDER, BORDER + TITLE_HEIGHT))
        self.rule((block_x + 26, BORDER), (block_x + 26, BORDER + TITLE_HEIGHT))
        row_h = TITLE_HEIGHT / len(rows)
        for i, (key, value) in enumerate(rows):
            y = BORDER + TITLE_HEIGHT - (i + 1) * row_h
            if i:
                self.rule((block_x, y + row_h), (self.paper_w - BORDER, y + row_h))
            self.text(key, block_x + 2, y + 1.8, 2.2, "TITLEBLOCK")
            self.text(value, block_x + 28, y + 1.8, 2.5, "TITLEBLOCK")

    def tables(self, x, y, sections):
        """Prints tables downward from y and counts the rows that run past the bottom of the sheet."""
        floor = BORDER + TITLE_HEIGHT + 2 * PANEL_ROW
        omitted = 0
        for heading, columns, table in sections:
            room = int((y - floor) / PANEL_ROW) - 2
            rows = table[:max(room, 0)]
            omitted += len(table) - len(rows)
            if not rows:
                continue
            self.text(heading, x, y, 2.8)
            y -= PANEL_ROW
            for name, column in columns:
                self.text(name, x + column, y, 2.0, "TITLEBLOCK")
            y -= PANEL_ROW
            for row in rows:
                for value, (_, column) in zip(row, columns, strict=True):
                    self.text(value, x + column, y, 2.2)
                y -= PANEL_ROW
            y -= 0.5 * PANEL_ROW
        if omitted:
            self.text(f"{omitted} MORE ROWS DO NOT FIT. SEE INSPECT.JSON.", x, floor - PANEL_ROW, 2.4)

    def notes(self, notes):
        for i, note in enumerate(notes):
            self.text(note, BORDER + 3, BORDER + TITLE_HEIGHT - 7 - i * 7, 3.0 if i == 0 else 2.4)


def page_names(doc) -> list:
    """Drawn sheets in order; ezdxf's empty default layout and model space are not pages."""
    return [name for name in doc.layout_names_in_taborder() if name not in ("Model", "Layout1")]


def named_parts(shape) -> list:
    children = list(getattr(shape, "children", None) or []) or [shape]
    return [(clean(child.label, 40, f"Part {i + 1}"), child) for i, child in enumerate(children)]


def wording(value) -> str:
    """A deal's words are printed as written, punctuation included; only control characters go."""
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(value)).strip()[:300]


def _read_view(axis: int, sign: int):
    """(u, v) as a reader facing this side sees it, so a line of lettering runs left to right."""
    if axis == 2:
        return (lambda p: (p[0], p[1])) if sign > 0 else (lambda p: (p[0], -p[1]))
    a, flip = (0, sign > 0) if axis == 1 else (1, sign < 0)
    return lambda p: (-p[a] if flip else p[a], p[2])


def _sample(edge) -> list:
    n = 1 if edge.geom_type == bd.GeomType.LINE else 16
    return [tuple(edge.position_at(i / n)) for i in range(n + 1)]


def _axis_of(normal) -> tuple[int, int] | None:
    for axis in range(3):
        if abs(abs(normal[axis]) - 1) < 1e-6:
            return axis, 1 if normal[axis] > 0 else -1
    return None


def _looks_like_a_letter(face) -> bool:
    edges = face.edges()
    kinds = {e.geom_type for e in edges}
    if kinds == {bd.GeomType.CIRCLE}:
        return False  # a counterbore's floor, not a letter
    return len(edges) > 4 or bool(kinds - {bd.GeomType.LINE, bd.GeomType.CIRCLE})


def _within(box, world, margin=0.5) -> bool:
    """Whether a face's box sits inside a line of lettering's extent."""
    low, high = world
    return all(low[i] - margin <= tuple(box.min)[i] and tuple(box.max)[i] <= high[i] + margin for i in range(3))


def _cluster_glyphs(faces: list) -> list:
    """Shapes that share a column are one letter, as the dot and stem of an i are."""
    glyphs = []
    for item in sorted(faces, key=lambda f: f["box"][0]):
        last = glyphs[-1] if glyphs else None
        narrower = min(item["box"][2] - item["box"][0], last["box"][2] - last["box"][0]) if last else 0
        if last and last["box"][2] - item["box"][0] > 0.5 * narrower:
            umin, vmin, umax, vmax = last["box"]
            box = item["box"]
            last["box"] = (min(umin, box[0]), min(vmin, box[1]), max(umax, box[2]), max(vmax, box[3]))
            last["paths"] += item["paths"]
        else:
            glyphs.append({"box": item["box"], "paths": list(item["paths"])})
    return glyphs


def _split_lines(faces: list) -> list:
    """Groups letter shapes into lines by height, tallest first so a small dot joins its line."""
    lines = []
    for item in sorted(faces, key=lambda f: f["box"][1] - f["box"][3]):
        middle = (item["box"][1] + item["box"][3]) / 2
        for line in lines:
            margin = 0.15 * (line["high"] - line["low"])
            if line["low"] - margin <= middle <= line["high"] + margin:
                line["faces"].append(item)
                line["low"], line["high"] = min(line["low"], item["box"][1]), max(line["high"], item["box"][3])
                break
        else:
            lines.append({"low": item["box"][1], "high": item["box"][3], "faces": [item]})
    return sorted(lines, key=lambda line: -line["high"])


def find_lettering(label: str, part) -> list:
    """Lines of cut or raised lettering, read from the solid: a coplanar group of small letter-shaped
    faces. Nothing here depends on how the model made them, so custom steps are covered too."""
    size = part.bounding_box().size
    limit = GLYPH_MAX_SPAN * max(size.X, size.Y, size.Z)
    groups, planes, large = {}, [], set()
    for face in part.faces():
        if face.geom_type != bd.GeomType.PLANE:
            continue
        side = _axis_of(tuple(face.normal_at()))
        if side is None:
            continue
        where = round(tuple(face.center())[side[0]], 3)
        planes.append((side, where, face.area))
        box = face.bounding_box().size
        if max(box.X, box.Y, box.Z) <= limit:
            groups.setdefault((*side, where), []).append(face)
        else:
            large.add((*side, where))
    found = []
    box = part.bounding_box()
    for (axis, sign, where), faces in groups.items():
        if (axis, sign, where) in large:
            continue  # coplanar with a large face: the islands left inside an A or an o, not letters
        if len(faces) < GLYPH_MIN_FACES or sum(map(_looks_like_a_letter, faces)) < 0.3 * len(faces):
            continue
        to_uv = _read_view(axis, sign)
        items = []
        for face in faces:
            paths = [[to_uv(p) for p in _sample(edge)] for edge in face.edges()]
            us, vs = [u for path in paths for u, _ in path], [v for path in paths for _, v in path]
            items.append({"box": (min(us), min(vs), max(us), max(vs)), "paths": paths, "face": face})
        hosts = [w for side, w, area in planes if side == (axis, sign) and w != where
                 and area >= max(f.area for f in faces) and abs(w - where) <= 5.0]
        host = min(hosts, key=lambda w: abs(w - where)) if hosts else None
        depth = abs(host - where) if host is not None else None
        kind = None if host is None else "CUT" if sign * (where - host) < 0 else "RAISED"
        corners = [to_uv(c) for c in itertools.product(*zip(tuple(box.min), tuple(box.max), strict=True))]
        origin = (min(u for u, _ in corners), min(v for _, v in corners))
        for line in _split_lines(items):
            glyphs = _cluster_glyphs(line["faces"])
            bounds = (min(g["box"][0] for g in glyphs), min(g["box"][1] for g in glyphs),
                      max(g["box"][2] for g in glyphs), max(g["box"][3] for g in glyphs))
            world = [f["face"].bounding_box() for f in line["faces"]]
            found.append({"part": label, "side": (axis, sign), "glyphs": glyphs, "bounds": bounds, "origin": origin,
                          "depth": depth, "kind": kind,
                          "world": ([min(tuple(b.min)[i] for b in world) for i in range(3)],
                                    [max(tuple(b.max)[i] for b in world) for i in range(3)])})
    return sorted(found, key=lambda line: (line["part"], -line["bounds"][3]))


def spec_lettering(parts, spec: dict) -> dict:
    """Pairs each line found in the solid with what the model declared for it. A declared line is
    tied by its step's measured extent, then by a letter count that matches exactly; anything still
    unpaired stays as printed-only wording, so no line is ever given another line's words."""
    if "_lettering" in spec:
        return spec["_lettering"]
    lines = [line for label, part in parts for line in find_lettering(label, part)]
    declared = [row for row in spec.get("lettering") or [] if isinstance(row, dict) and row.get("text")]
    boxes = {item.get("name"): item.get("bbox") for item in spec.get("text") or [] if isinstance(item, dict)}
    free = list(declared)
    for line in lines:
        low, high = line["world"]
        for row in free:
            box = boxes.get(row.get("name"))
            if box and all(low[i] - 0.5 <= (box["min"][i] + box["max"][i]) / 2 <= high[i] + 0.5 for i in range(3)):
                line["row"] = row
                free.remove(row)
                break
    for line in lines:
        if "row" in line:
            continue
        for row in free:
            if len(re.sub(r"\s", "", row["text"])) == len(line["glyphs"]):
                line["row"] = row
                free.remove(row)
                break
    spec["_lettering"] = {"lines": lines, "unplaced": free}
    return spec["_lettering"]


def _line_scale(line) -> float:
    width, height = line["bounds"][2] - line["bounds"][0], line["bounds"][3] - line["bounds"][1]
    room = PAPER[1] - BORDER - 8 - BORDER - LINE_LEFT
    for factor in ENLARGEMENTS:
        if width * factor <= room and height * factor <= LINE_MAX_HEIGHT:
            return factor
    return ENLARGEMENTS[-1]


def _strip_height(line) -> float:
    rows = math.ceil(len(line["glyphs"]) / LETTER_CELLS)
    return 10 + (line["bounds"][3] - line["bounds"][1]) * _line_scale(line) + 20 + rows * (len(LETTER_HEADS) * LETTER_ROW + 2)


def lettering_pages(details: dict) -> list:
    """Splits the lines across sheets; each page is (lines, printed-only rows)."""
    room = PAPER[2] - 2 * BORDER - TITLE_HEIGHT - 10
    pages, current, used = [], [], 0.0
    for line in details["lines"]:
        need = _strip_height(line)
        if current and used + need > room:
            pages.append((current, []))
            current, used = [], 0.0
        current.append(line)
        used += need
    unplaced = details["unplaced"]
    if unplaced and used + 16 + len(unplaced) * PANEL_ROW > room and current:
        pages.append((current, []))
        current = []
    if current or unplaced:
        pages.append((current, unplaced))
    return pages


def without_lettering(view: str, segments: list, lines: list) -> list:
    """Drops hidden edges of the letters themselves, which would otherwise swamp the holes behind them."""
    _, _, (a, b), _ = VIEWS[view]
    boxes = [(low[a] - 0.5, low[b] - 0.5, high[a] + 0.5, high[b] + 0.5) for low, high in (line["world"] for line in lines)]

    def lettering(segment):
        return any(all(u0 <= u <= u1 and v0 <= v <= v1 for u, v in segment) for u0, v0, u1, v1 in boxes)

    return [segment for segment in segments if not lettering(segment)]


def _detail_override(factor: float) -> dict:
    """Paper-space dimensions: drawn at the sheet's scale, reading the real length."""
    return {"dimscale": 1.0, "dimtxt": 2.6, "dimasz": 2.2, "dimexo": 1.0, "dimexe": 1.5, "dimgap": 0.7, "dimdec": 2,
            "dimzin": 8, "dimlfac": 1 / factor, "dimclrd": 5, "dimclre": 5, "dimclrt": 5, "dimtad": 1, "dimjust": 0,
            "dimtxsty": FONT}


def _layout_name(number: int, label: str) -> str:
    return f"S{number} " + re.sub(r"[^A-Za-z0-9 _-]", "", label)[:24]


def _page_frame(doc, number, total, label, kind, scale_text, context, notes):
    page = Page(doc, _layout_name(number, label))
    page.frame(BORDER, BORDER, page.paper_w - BORDER, page.paper_h - BORDER)
    page.title_block([("TITLE", f"{context['title']} - {clean(label, 30, '-')}"), ("PROJECT", context["project"]),
                      ("REVISION", context["revision"]), ("DATE", context["date"]), ("SCALE", scale_text),
                      ("UNITS", "MM - DO NOT SCALE DRAWING"), ("PROJECTION", "THIRD ANGLE"),
                      ("SHEET", f"{number} OF {total} - {kind}")])
    page.notes(notes)
    return page


def choose_part_layout(width, depth, height):
    """The largest scale at which views and a section fit, section beside the views or above them."""
    room_w = PAPER[1] - 2 * BORDER - PANEL_WIDTH - PART_LEFT - 8
    room_h = PAPER[2] - 2 * BORDER - TITLE_HEIGHT - PART_BELOW - 6
    for factor in ENLARGEMENTS:
        if (2 * width + depth) * factor <= room_w - 2 * PART_GAP and (height + depth) * factor <= room_h - PART_GAP:
            return factor, "beside"
        if (width + depth) * factor <= room_w - PART_GAP and (2 * height + depth) * factor <= room_h - 2 * PART_GAP:
            return factor, "above"
    raise ValueError("Part is too large for the sheet")


def plane_stations(part, axis: int, lines: list) -> list:
    """Positions of the part's flat faces across one axis, leaving out the floors of its lettering."""
    areas = {}
    for face in part.faces():
        if face.geom_type != bd.GeomType.PLANE:
            continue
        side = _axis_of(tuple(face.normal_at()))
        if side is None or side[0] != axis:
            continue
        box = face.bounding_box()
        in_text = any(_within(box, line["world"]) for line in lines)
        if not in_text:
            where = round(tuple(face.center())[axis], 3)
            areas[where] = areas.get(where, 0.0) + face.area
    return sorted(sorted(areas, key=lambda w: -areas[w])[:MAX_BAND_EDGES])


def edge_treatments(part, lines: list) -> list:
    """Chamfers and radii the solid actually has, counted by size."""
    counts = {}
    for face in part.faces():
        box = face.bounding_box()
        if any(_within(box, line["world"]) for line in lines):
            continue
        if face.geom_type == bd.GeomType.PLANE:
            normal = tuple(face.normal_at())
            if _axis_of(normal) is not None:
                continue
            spans = [s for s, n in zip(tuple(box.size), normal, strict=True) if abs(n) > 1e-6]
            key = ("CHAMFER", round(min(spans), 2))
        elif face.geom_type == bd.GeomType.CYLINDER and not _full_bore(face):
            key = ("RADIUS", round(face.radius, 2))
        else:
            continue
        counts[key] = counts.get(key, 0) + 1
    return [(kind, f"{value:.2f}", f"x{n}") for (kind, value), n in sorted(counts.items())]


def _full_bore(face) -> bool:
    return any(edge.is_closed and edge.geom_type == bd.GeomType.CIRCLE for edge in face.edges())


def section_loops(part, y: float, box) -> list:
    """Closed outlines of the part cut by the plane Y = y, as [(outer, [inner, ...])] in (x, z)."""
    size = box.size
    plane = bd.Plane(origin=(box.center().X, y, box.center().Z), x_dir=(1, 0, 0), z_dir=(0, -1, 0))
    sheet = (plane * bd.Rectangle(size.X * 1.5, size.Z * 1.5)).faces()[0]
    common = BRepAlgoAPI_Common(part.wrapped, sheet.wrapped)
    common.Build()
    if not common.IsDone():
        return []

    def loop(wire):
        pieces = [[(p[0], p[2]) for p in _sample(edge)] for edge in wire.edges()]
        path = list(pieces.pop(0))
        while pieces:
            end = path[-1]
            piece = min(pieces, key=lambda p: min(math.dist(end, p[0]), math.dist(end, p[-1])))
            pieces.remove(piece)
            path += piece if math.dist(path[-1], piece[0]) <= math.dist(path[-1], piece[-1]) else piece[::-1]
        return path

    return [(loop(face.outer_wire()), [loop(wire) for wire in face.inner_wires()]) for face in bd.Shape.cast(common.Shape()).faces()]


def part_holes(spec: dict, label: str, lows) -> list:
    """Holes in this part, keeping the numbers sheet 1 gives them."""
    def read(item):
        return (float(mm(item["diameter"])), item)

    rows = []
    for number, (_, item) in enumerate(_rows(spec.get("holes"), read), 1):
        if clean(item["part"], 16, "-") != clean(label, 16, "-"):
            continue
        rows.append({"id": f"H{number}", "item": item, "offset": [item["at"][i] - lows[i] for i in range(3)]})
    return rows


def part_sheet(doc, number, total, label, part, spec, context, lines):
    box = part.bounding_box()
    lows, size = tuple(box.min), tuple(box.size)
    width, depth, height = size
    factor, layout = choose_part_layout(width, depth, height)
    mine = [line for line in lines if line["part"] == label]
    holes_here = part_holes(spec, label, lows)
    notes = ["NOTES", f"1. PART {clean(label, 30, '-')}, {width:.2f} W x {depth:.2f} D x {height:.2f} H MM, MEASURED FROM THE SOLID.",
             "2. HOLE POSITIONS ARE MEASURED FROM THE PART'S LEFT, FRONT AND BOTTOM FACES.",
             "3. TOLERANCES NOT SPECIFIED. SEE THE MANUFACTURING BRIEF.",
             "4. DRAFT DERIVED FROM THE MODEL. NOT REVIEWED OR APPROVED FOR MANUFACTURE."]
    if mine:
        notes.append("5. LETTERING ON THIS PART IS DETAILED ON THE LETTERING SHEET.")
    page = _page_frame(doc, number, total, label, "PART", f"{scale_label(factor)} ON {PAPER[0]}", context, notes)
    sheet = page.layout
    override = _detail_override(factor)
    gap, row = PART_GAP, PART_ROW

    room_w = page.paper_w - 2 * BORDER - PANEL_WIDTH - PART_LEFT - 8
    room_h = page.paper_h - 2 * BORDER - TITLE_HEIGHT - PART_BELOW - 6
    beside = layout == "beside"
    used_w = ((2 * width + depth) * factor + 2 * gap) if beside else ((width + depth) * factor + gap)
    used_h = ((height + depth) * factor + gap) if beside else ((2 * height + depth) * factor + 2 * gap)
    x0 = BORDER + PART_LEFT + (room_w - used_w) / 2
    y0 = BORDER + TITLE_HEIGHT + PART_BELOW + (room_h - used_h) / 2
    origin = {"front": (x0, y0), "top": (x0, y0 + height * factor + gap), "right": (x0 + width * factor + gap, y0)}
    section_at = (x0 + (width + depth) * factor + 2 * gap, y0) if beside else (x0, y0 + (height + depth) * factor + 2 * gap)

    def to_paper(view, u, v):
        _, _, (a, b), _ = VIEWS[view]
        return origin[view][0] + (u - lows[a]) * factor, origin[view][1] + (v - lows[b]) * factor

    def dim(p1, p2, base, angle):
        sheet.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle, override=override, dxfattribs={"layer": "DIMENSIONS"}).render()

    def caption(value, x, y):
        page.text(value, x, y, 3.2, align=TextEntityAlignment.MIDDLE_CENTER)

    deflection = max(max(size) / 4000, 0.005)
    for view in origin:
        visible, hidden = project(part, view, deflection)
        hidden = without_lettering(view, hidden, mine)
        if len(hidden) > MAX_HIDDEN_EDGES:
            hidden = []
        for layer, drawn in (("OUTLINE", visible), ("HIDDEN", hidden)):
            for line in chain(drawn):
                sheet.add_lwpolyline([to_paper(view, u, v) for u, v in line], dxfattribs={"layer": layer, "ltscale": 0.5})

    fx, fy = origin["front"]
    tx, ty = origin["top"]
    rx, ry = origin["right"]
    w, d, h = width * factor, depth * factor, height * factor
    min_step = MIN_BAND / factor
    z_steps = bands([(v, v) for v in plane_stations(part, 2, mine)], min_step)
    x_steps = bands([(v, v) for v in plane_stations(part, 0, mine)], min_step)
    y_steps = bands([(v, v) for v in plane_stations(part, 1, mine)], min_step)
    for low, high in z_steps:
        dim((fx, fy + (low - lows[2]) * factor), (fx, fy + (high - lows[2]) * factor), (fx - row, 0), 90)
    for low, high in x_steps:
        dim((fx + (low - lows[0]) * factor, fy), (fx + (high - lows[0]) * factor, fy), (0, fy - row), 0)
    for low, high in y_steps:
        dim((rx + (low - lows[1]) * factor, ry), (rx + (high - lows[1]) * factor, ry), (0, ry - row), 0)
    dim((fx, fy), (fx + w, fy), (0, fy - row * (2 if x_steps else 1)), 0)
    dim((fx, fy), (fx, fy + h), (fx - row * (2 if z_steps else 1), 0), 90)
    dim((rx, ry), (rx + d, ry), (0, ry - row * (2 if y_steps else 1)), 0)
    caption("FRONT", fx + w / 2, fy - 3 * row + 3)
    caption("RIGHT", rx + d / 2, ry - 3 * row + 3)

    # Holes: a centre mark and a tag on the view looking down each axis, and positions across the top view.
    tags = {}
    for hole in holes_here:
        direction = hole["item"].get("axis")
        side = _axis_of(tuple(direction)) if isinstance(direction, list) and len(direction) == 3 else None
        view = {2: "top", 1: "front", 0: "right"}.get(side[0]) if side else None
        if view is None:
            continue
        _, _, (a, b), _ = VIEWS[view]
        at = hole["item"]["at"]
        tags.setdefault((view, round(at[a], 3), round(at[b], 3)), []).append(hole)
    for (view, u, v), group in tags.items():
        cx, cy = to_paper(view, u, v)
        radius = max(float(hole["item"]["diameter"]) for hole in group) / 2 * factor
        mark = radius * 1.2
        for start, end in (((cx - mark, cy), (cx + mark, cy)), ((cx, cy - mark), (cx, cy + mark))):
            page.rule(start, end, "CENTER")
        page.text("/".join(hole["id"] for hole in group), cx + radius + 0.8, cy + radius + 0.8, 2.2)
    stations = sorted({round(hole["item"]["at"][0], 3) for hole in holes_here
                       if hole["item"].get("axis") and _axis_of(tuple(hole["item"]["axis"])) in ((2, 1), (2, -1))})
    last = lows[0]
    placed = False
    for station in stations:
        if (station - last) * factor >= MIN_BAND:
            dim((tx + (last - lows[0]) * factor, ty + d), (tx + (station - lows[0]) * factor, ty + d), (0, ty + d + row), 0)
            last, placed = station, True
    caption("TOP", tx + w / 2, ty + d + (2 if placed else 1) * row - 1)

    # Section through the holes, or through the middle when there are none across this view.
    across = [round(hole["item"]["at"][1], 3) for hole in holes_here if hole["item"].get("axis")
              and abs(hole["item"]["axis"][1]) < 1e-6]
    cut_y = max(set(across), key=across.count) if across else box.center().Y
    loops = []
    try:
        loops = section_loops(part, cut_y, box)
    except (ValueError, IndexError, AttributeError, RuntimeError):
        loops = []
    sx, sy = section_at
    if loops:
        def on_sheet(path):
            return [(sx + (x - lows[0]) * factor, sy + (z - lows[2]) * factor) for x, z in path]

        hatch = sheet.add_hatch(color=8, dxfattribs={"layer": "HATCH"})
        hatch.set_pattern_fill("ANSI31", scale=0.5)
        for outer, inners in loops:
            hatch.paths.add_polyline_path(on_sheet(outer), is_closed=True, flags=1)
            for inner in inners:
                hatch.paths.add_polyline_path(on_sheet(inner), is_closed=True, flags=16)
            for path in [outer, *inners]:
                sheet.add_lwpolyline(on_sheet(path), close=True, dxfattribs={"layer": "OUTLINE"})
        caption("SECTION A-A", sx + w / 2, sy + h + 6 if layout == "above" else sy - 3 * row + 3)
        cut = ty + (cut_y - lows[1]) * factor
        page.rule((tx - 5, cut), (tx + w + 5, cut), "CENTER")
        page.text("A", tx - 8, cut - 1.2, 2.8)
        page.text("A", tx + w + 6, cut - 1.2, 2.8)

    # The panel: a picture of the part, then what was measured of it.
    panel_x = page.paper_w - BORDER - PANEL_WIDTH
    top = page.paper_h - BORDER
    page.rule((panel_x, BORDER + TITLE_HEIGHT), (panel_x, top))
    iso, _ = project(part, "iso", deflection)
    us, vs = [u for line in iso for u, _ in line], [v for line in iso for _, v in line]
    pic_h = 56.0
    if us:
        fit = min((PANEL_WIDTH - 10) / max(max(us) - min(us), 1e-6), pic_h / max(max(vs) - min(vs), 1e-6))
        cx, cy = panel_x + PANEL_WIDTH / 2, top - 6 - pic_h / 2
        mu, mv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
        for line in chain(iso):
            sheet.add_lwpolyline([(cx + fit * (u - mu), cy + fit * (v - mv)) for u, v in line], dxfattribs={"layer": "PICTORIAL"})
        page.text("ISOMETRIC, REFERENCE ONLY, NOT TO SCALE", panel_x + PANEL_WIDTH / 2, top - pic_h - 10, 2.4,
                  align=TextEntityAlignment.MIDDLE_CENTER)
    facts = []
    for material in spec.get("materials") or []:
        if isinstance(material, dict) and clean(material.get("part"), 40, "-") == label:
            facts.append(("Material", clean(material.get("name"), 60, "-")))
            if "mass" in material:
                facts.append(("Mass, g", mm(material["mass"])))
    facts += [("Volume, mm3", f"{part.volume:,.0f}"), ("Surface area, mm2", f"{part.area:,.0f}"),
              ("Position in toy, X Y Z", ", ".join(f"{v:.2f}" for v in lows))]
    hole_rows = [(hole["id"], mm(hole["item"]["diameter"]), mm(hole["item"]["depth"]),
                  "BLIND" if hole["item"].get("blind") else "THRU",
                  *(mm(v) for v in hole["offset"])) for hole in holes_here]
    dims = [(clean(item.get("name"), 70, "-"), mm(item["value"]) + ("" if item.get("matches", True) else " CHECK"))
            for item in _rows(spec.get("dimensions"), lambda row: row) if item.get("part") == label and "value" in item]
    sections = [("THIS PART", (("ITEM", 0), ("VALUE", 42)), facts),
                ("HOLES", (("ID", 0), ("DIA", 10), ("DEPTH", 24), ("END", 40), ("FROM L", 58), ("FROM F", 78), ("FROM B", 98)), hole_rows),
                ("FEATURE DIMENSIONS", (("NAME", 0), ("MM", 100)), dims),
                ("EDGES", (("TYPE", 0), ("SIZE MM", 30), ("FACES", 60)), edge_treatments(part, mine))]
    page.tables(panel_x + 3, top - pic_h - 17, [section for section in sections if section[2]])


def _placer(x, y, u0, v0, factor):
    return lambda u, v: (x + (u - u0) * factor, y + (v - v0) * factor)


def lettering_sheet(doc, number, total, content, context):
    lines, unplaced = content
    notes = ["NOTES",
             "1. LETTER SHAPES ARE TRACED FROM THE SOLID AND DRAWN AT EACH LINE'S STATED SCALE.",
             "2. TABLES: L AND B ARE EACH LETTER'S LEFT AND BOTTOM FROM THE PART'S LEFT AND BOTTOM IN THAT VIEW; W AND H ITS SIZE. MM.",
             "3. TOLERANCES NOT SPECIFIED. SEE THE MANUFACTURING BRIEF.",
             "4. DRAFT DERIVED FROM THE MODEL. NOT REVIEWED OR APPROVED FOR MANUFACTURE."]
    page = _page_frame(doc, number, total, "Lettering", "LETTERING", "PER LINE, AS STATED", context, notes)
    sheet = page.layout
    x = BORDER + 6
    y = page.paper_h - BORDER - 7
    for line in lines:
        factor = _line_scale(line)
        row = line.get("row", {})
        umin, vmin, umax, vmax = line["bounds"]
        method = row.get("method", "").upper() or line["kind"] or "-"
        facts = [f"SCALE {scale_label(factor)}", f"PART {line['part']}", f"METHOD {method}"]
        if line["depth"] is not None:
            facts.append(f"{'DEPTH' if line['kind'] == 'CUT' else 'RISE'} {line['depth']:.2f}")
        if row.get("font"):
            facts.append(f"FONT {clean(row['font'], 40, '-')}")
        if row.get("height"):
            facts.append(f"FONT SIZE {row['height']:.2f}")
        words = wording(row["text"]) if row.get("text") else "WORDING NOT DECLARED BY THE MODEL"
        page.text(words, x, y, 3.2)
        page.text("   ".join(facts), x, y - 5, 2.3)
        base_y = y - 10 - (vmax - vmin) * factor
        base_x = BORDER + LINE_LEFT

        place = _placer(base_x, base_y, umin, vmin, factor)
        for glyph in line["glyphs"]:
            for path in glyph["paths"]:
                sheet.add_lwpolyline([place(u, v) for u, v in path], dxfattribs={"layer": "LETTERING"})
        override = _detail_override(factor)
        attrs = {"layer": "DIMENSIONS"}
        sheet.add_linear_dim(base=(0, base_y - 11), p1=place(umin, vmin), p2=place(umax, vmin), angle=0, override=override,
                             dxfattribs=attrs).render()
        sheet.add_linear_dim(base=(base_x - 10, 0), p1=place(umin, vmin), p2=place(umin, vmax), angle=90, override=override,
                             dxfattribs=attrs).render()
        for i, glyph in enumerate(line["glyphs"], 1):
            cx, _ = place((glyph["box"][0] + glyph["box"][2]) / 2, vmin)
            page.text(str(i), cx, base_y - 3, 1.8, "DIMENSIONS", TextEntityAlignment.MIDDLE_CENTER)
        letters = re.sub(r"\s", "", row["text"]) if row.get("text") else ""
        named = len(letters) == len(line["glyphs"])
        y = base_y - 19
        origin_u, origin_v = line["origin"]
        for start in range(0, len(line["glyphs"]), LETTER_CELLS):
            for k, head in enumerate(LETTER_HEADS):
                page.text(head, x, y - k * LETTER_ROW, 2.0, "TITLEBLOCK")
            for column, glyph in enumerate(line["glyphs"][start:start + LETTER_CELLS]):
                index = start + column
                gu0, gv0, gu1, gv1 = glyph["box"]
                cells = (str(index + 1), letters[index] if named else "-", f"{gu0 - origin_u:.2f}", f"{gv0 - origin_v:.2f}",
                         f"{gu1 - gu0:.2f}", f"{gv1 - gv0:.2f}")
                for k, value in enumerate(cells):
                    page.text(value, x + 10 + column * LETTER_CELL, y - k * LETTER_ROW, 2.0)
            y -= len(LETTER_HEADS) * LETTER_ROW + 2
        y -= 3
    if unplaced:
        def row_of(item):
            size = f"{item['height']:.2f}" if "height" in item else "-"
            return (wording(item["text"]), clean(item.get("method"), 24, "-"), clean(item.get("font"), 40, "-"), size)

        page.tables(x, y, [("LETTERING NOT TRACED FROM THE SOLID (PRINTED, OR NOT FOUND IN THE GEOMETRY)",
                            (("WORDING", 0), ("METHOD", 230), ("FONT", 270), ("SIZE", 340)), [row_of(item) for item in unplaced])])


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

    parts = named_parts(shape)
    shown = parts[:MAX_PART_SHEETS]
    total = 1 + len(shown) + len(lettering_pages(spec_lettering(parts, spec)))
    context = {"title": title, "project": clean(spec.get("project"), 60, "-"), "revision": revision, "date": date}

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
        hidden = without_lettering(view, hidden, spec_lettering(parts, spec)["lines"])
        if len(hidden) > MAX_HIDDEN_EDGES:
            hidden, hidden_omitted = [], True
        for layer, lines in (("OUTLINE", visible), ("HIDDEN", hidden)):
            for line in chain(lines):
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

    # Steps between the parts, read from each solid's extents, sit inside the overall dimensions.
    boxes = [s.bounding_box() for s in shape.solids()]
    x_steps, y_steps, z_steps = (bands([(tuple(b.min)[axis], tuple(b.max)[axis]) for b in boxes], MIN_BAND * scale)
                                 for axis in range(3))
    top_y = placed["top"][1]
    for low, high in z_steps:
        linear((0, low - lows[2]), (0, high - lows[2]), (-offset, 0), 90)
    for low, high in x_steps:
        linear((low - lows[0], top_y), (high - lows[0], top_y), (0, top_y - offset), 0)
    for low, high in y_steps:
        linear((width, top_y + low - lows[1]), (width, top_y + high - lows[1]), (width + offset, 0), 90)

    # Overall dimensions are measured between the extreme points of the drawn geometry.
    linear(extreme("front", 0, min), extreme("front", 0, max), (0, -offset), 0)
    linear(extreme("front", 1, min), extreme("front", 1, max), (-offset * (2 if z_steps else 1), 0), 90)
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
    page = Page(doc, paper)
    sheet = page.layout
    area = (BORDER, BORDER + TITLE_HEIGHT, paper_w - BORDER - panel, paper_h - BORDER)
    area_w, area_h = area[2] - area[0], area[3] - area[1]
    view_center = ((width + gap + depth) / 2, (height + gap + depth) / 2)
    sheet.add_viewport(center=((area[0] + area[2]) / 2, (area[1] + area[3]) / 2), size=(area_w, area_h),
                       view_center_point=view_center, view_height=area_h * scale, dxfattribs={"layer": "VIEWPORTS"})

    # The isometric takes the free corner above the right view, reduced if it has to be.
    iso, _ = project(shape, "iso", deflection)
    us, vs = [u for line in iso for u, _ in line], [v for line in iso for _, v in line]
    left, floor_y = width + 0.7 * gap, height + 0.6 * gap + offset
    room_u = view_center[0] + (area_w / 2 - 6) * scale - left
    room_v = view_center[1] + (area_h / 2 - 6) * scale - floor_y
    pictorial = False
    if us and room_u > 0 and room_v > 0:
        fit = min(room_u / max(max(us) - min(us), 1e-6), room_v / max(max(vs) - min(vs), 1e-6), 1.0)
        pictorial = fit >= MIN_PICTORIAL
    if pictorial:
        cu = left + room_u / 2 - fit * (min(us) + max(us)) / 2
        cv = floor_y + room_v / 2 - fit * (min(vs) + max(vs)) / 2
        for line in chain(iso):
            msp.add_lwpolyline([(cu + fit * u, cv + fit * v) for u, v in line], dxfattribs={"layer": "PICTORIAL"})
        label("ISOMETRIC, REFERENCE ONLY", left + room_u / 2, floor_y - offset / 2)

    page.frame(BORDER, BORDER, paper_w - BORDER, paper_h - BORDER)
    page.title_block([("TITLE", title), ("PROJECT", clean(spec.get("project"), 60, "-")), ("REVISION", revision), ("DATE", date),
                      ("SCALE", f"{scale_label(factor)} ON {paper}"), ("UNITS", "MM - DO NOT SCALE DRAWING"),
                      ("PROJECTION", "THIRD ANGLE"), ("SHEET", f"1 OF {total} - WHOLE TOY")])
    if sections:
        panel_x = paper_w - BORDER - panel
        page.rule((panel_x, BORDER + TITLE_HEIGHT), (panel_x, paper_h - BORDER))
        y = paper_h - BORDER - 6
        page.text("ALL VALUES IN MM, MEASURED FROM THE BUILD", panel_x + 3, y, 2.4)
        page.tables(panel_x + 3, y - 1.5 * PANEL_ROW, sections)
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
    if x_steps or y_steps or z_steps:
        notes.append(f"{len(notes)}. INNER DIMENSIONS ARE STEPS BETWEEN THE EXTENTS OF THE SOLIDS.")
    if hidden_omitted:
        notes.append(f"{len(notes)}. HIDDEN LINES OMITTED: THIS MODEL HAS TOO MANY FOR A LEGIBLE SHEET.")
    if len(parts) > len(shown):
        notes.append(f"{len(notes)}. {len(parts) - len(shown)} MORE PARTS HAVE NO SHEET OF THEIR OWN. SEE THE STEP FILE.")
    page.notes(notes)
    details = spec_lettering(parts, spec)
    pages = lettering_pages(details)
    for number, (label, part) in enumerate(shown, 2):
        part_sheet(doc, number, total, label, part, spec, context, details["lines"])
    for offset, content in enumerate(pages):
        lettering_sheet(doc, len(shown) + 2 + offset, total, content, context)

    destination.mkdir(exist_ok=True)
    auditor = doc.audit()
    if auditor.has_errors:
        raise ValueError(f"Drawing failed its DXF audit: {auditor.errors[:3]}")
    doc.saveas(destination / "blueprint.dxf")

    config = Configuration(background_policy=BackgroundPolicy.WHITE, lineweight_scaling=1.0)
    with PdfPages(destination / "blueprint.pdf") as pdf:
        for number, name in enumerate(page_names(doc), 1):
            figure = plt.figure(figsize=(paper_w / 25.4, paper_h / 25.4))
            axes = figure.add_axes([0, 0, 1, 1])
            Frontend(RenderContext(doc), MatplotlibBackend(axes), config=config).draw_layout(doc.layouts.get(name), finalize=True)
            figure.set_size_inches(paper_w / 25.4, paper_h / 25.4)  # the frontend resizes the figure to its content
            axes.set_position([0, 0, 1, 1])
            axes.set_xlim(0, paper_w)
            axes.set_ylim(0, paper_h)
            axes.set_aspect("equal")
            pdf.savefig(figure)
            if spec.get("png"):  # local review of the sheets; the service does not ship them
                figure.savefig(destination / ("blueprint.png" if number == 1 else f"blueprint_{number}.png"), dpi=150)
            plt.close(figure)
    return {"scale": scale_label(factor), "paper": paper, "circle_sizes": len(sizes), "sheets": total,
            "hidden_omitted": hidden_omitted, "bounds": size, "pictorial": pictorial}


if __name__ == "__main__":
    limits()
    draw(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()), Path(sys.argv[3]))
