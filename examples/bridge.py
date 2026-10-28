"""Synthetic demonstration, millimetres and Z up; not a production design."""
import build123d as bd

PARAMS = {
    "BASE_L": {"value": 100.0, "unit": "mm", "part": "Base", "min": 60, "max": 200},
    "BASE_D": {"value": 55.0, "unit": "mm", "part": "Base", "min": 30, "max": 120},
    "BASE_H": {"value": 8.0, "unit": "mm", "part": "Base", "min": 4, "max": 20},
    "PIER_H": {"value": 35.0, "unit": "mm", "part": "Piers", "min": 10, "max": 80},
    "PIER_GAP": {"value": 60.0, "unit": "mm", "part": "Piers", "min": 20, "max": 160},
    "SPAN_T": {"value": 8.0, "unit": "mm", "part": "Span", "min": 3, "max": 20},
}


def size(name):
    return PARAMS[name]["value"]


def build():
    bottom = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)
    base = bd.Box(size("BASE_L"), size("BASE_D"), size("BASE_H"), align=bottom)
    base.label = "Base"
    base.color = bd.Color(0.20, 0.22, 0.26)
    top = size("BASE_H")
    pier = bd.Box(10, 15, size("PIER_H"), align=bottom)
    half = size("PIER_GAP") / 2
    piers = bd.Pos(-half, 0, top) * pier + bd.Pos(half, 0, top) * pier
    piers.label = "Piers"
    piers.color = bd.Color(0.72, 0.74, 0.77)
    span = bd.Pos(0, 0, top + size("PIER_H")) * bd.Box(
        size("PIER_GAP") + 10, 15, size("SPAN_T"), align=bottom)
    span.label = "Span"
    span.color = bd.Color(0.65, 0.42, 0.19)
    return bd.Compound(children=[base, piers, span], label="Bridge study")
