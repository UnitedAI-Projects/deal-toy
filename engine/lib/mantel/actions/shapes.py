"""The revolve, loft, sweep, shell and appearance actions: round bodies, blended outlines, handles,
vessels and part colours."""
from itertools import pairwise

import build123d as bd

from .. import geometry as g
from ..model import StepError, builtin
from .features import _cut, _join, _new_faces


def _place(m, name, solid, operation, target):
    """Adds the new solid as its own part, or joins it to or cuts it from the target."""
    if not solid.solids() or not solid.is_valid:
        raise StepError("invalid_geometry", "The shape is not a valid solid; check the points and sizes")
    if operation == "new":
        m.parts[name] = solid
        return name, None, solid
    label = m.resolve_part(target)
    before, after = (_cut if operation == "cut" else _join)(m, label, solid)
    return label, before, after


def _surface(owner, before, after):
    return {"surface": (owner, _new_faces(before, after))}


def _geometry(build):
    """Runs an OCCT construction, reporting its failure as invalid geometry."""
    try:
        return build()
    except StepError:
        raise
    except Exception as error:  # noqa: BLE001 - OCCT raises many types for impossible shapes
        raise StepError("invalid_geometry", f"The shape could not be built: {error or type(error).__name__}") from None


@builtin("revolve")
def revolve(m, name, profile, smooth=False, angle=360, at=None, operation="new", target=None):
    if any(r < 0 for r, _ in profile):
        raise StepError("invalid_input", "profile radii (the first value of each point) must not be negative")
    origin = g.vec(at or (0, 0, 0))
    points = [origin + bd.Vector(r, 0, z) for r, z in profile]
    if len({(round(p.X, 6), round(p.Z, 6)) for p in points}) != len(points):
        raise StepError("invalid_input", "profile repeats a point")

    def build():
        if smooth:
            outline = bd.Wire([bd.Spline(*points), bd.Line(points[-1], points[0])])
        else:
            outline = bd.Wire.make_polygon(points, close=True)
        return bd.revolve(bd.Face(outline), bd.Axis(origin, (0, 0, 1)), angle)
    owner, before, after = _place(m, name, _geometry(build), operation, target)
    return _surface(owner, before, after)


def _outline(section, origin):
    shape, z = section["shape"], section["z"]
    if shape == "circle":
        sketch = bd.Circle(section["diameter"] / 2)
    elif shape == "ellipse":
        sketch = bd.Ellipse(section["width"] / 2, section["length"] / 2)
    elif shape == "rectangle":
        sketch = bd.Rectangle(section["width"], section["length"])
    else:
        width, length, radius = section["width"], section["length"], section["radius"]
        if radius * 2 >= min(width, length):
            raise StepError("invalid_geometry", "A section's corner radius must be less than half its smaller side")
        sketch = bd.RectangleRounded(width, length, radius)
    return bd.Plane.XY.offset(z).move(bd.Location(origin)) * sketch


@builtin("loft")
def loft(m, name, sections, ruled=False, at=None, operation="new", target=None):
    heights = [s["z"] for s in sections]
    if any(b <= a for a, b in pairwise(heights)):
        raise StepError("invalid_input", "sections must be listed from bottom to top with strictly increasing z")
    origin = g.vec(at or (0, 0, 0))
    outlines = [_outline(s, origin) for s in sections]
    owner, before, after = _place(m, name, _geometry(lambda: bd.loft(outlines, ruled=ruled)), operation, target)
    return _surface(owner, before, after)


@builtin("sweep")
def sweep(m, name, path, section="circle", diameter=None, width=None, length=None, smooth=True,
          operation="join", target=None):
    points = [g.vec(p) for p in path]
    if any((b - a).length < 1e-6 for a, b in pairwise(points)):
        raise StepError("invalid_input", "path repeats a point")

    def build():
        curve = bd.Spline(*points) if smooth and len(points) > 2 else bd.Wire.make_polygon(points, close=False)
        plane = bd.Plane(origin=curve @ 0, z_dir=curve % 0)
        if section == "circle":
            sketch = bd.Circle(diameter / 2)
        elif section == "ellipse":
            sketch = bd.Ellipse(width / 2, length / 2)
        else:
            sketch = bd.Rectangle(width, length)
        return bd.sweep(plane * sketch, path=curve, transition=bd.Transition.ROUND)
    owner, before, after = _place(m, name, _geometry(build), operation, target)
    return _surface(owner, before, after)


@builtin("shell")
def shell(m, name, target, thickness, open=None, inward=True):
    label = m.resolve_part(target)
    faces = []
    for ref in open or []:
        owner, found = m.resolve_faces(ref)
        if owner != label:
            raise StepError("face_not_found", f'The open face {ref} does not belong to "{label}"')
        faces.extend(found)
    before = m.parts[label]
    amount = -thickness if inward else thickness

    def hollow():
        # Rounded offsets fail on some blended walls, such as a flared loft; sharp ones then work.
        try:
            return bd.offset(before, amount=amount, openings=faces or None)
        except Exception:  # noqa: BLE001 - OCCT reports offset failures with assorted types
            return bd.offset(before, amount=amount, openings=faces or None, kind=bd.Kind.INTERSECTION)
    after = _geometry(hollow)
    if not after.solids() or not after.is_valid or abs(after.volume - before.volume) < 1e-6:
        raise StepError("invalid_geometry", "The part could not be hollowed at this thickness")
    m.parts[label] = after
    return {"inside": (label, _new_faces(before, after))}


@builtin("appearance")
def appearance(m, name, target, color, finish="satin"):
    label = m.resolve_part(target)
    m.looks[label] = (tuple(float(c) for c in color), finish)
    return {}
