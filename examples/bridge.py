"""Synthetic demonstration, millimetres and Z up; not a production design."""
import build123d as bd


def build():
    base = bd.Box(100, 55, 8, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    left = bd.Pos(-30, 0, 8) * bd.Box(10, 15, 35, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    right = bd.Pos(30, 0, 8) * bd.Box(10, 15, 35, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    span = bd.Pos(0, 0, 43) * bd.Box(70, 15, 8, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    result = base + left + right + span
    result.label = "Bridge study"
    result.color = bd.Color(0.65, 0.42, 0.19)
    return result
