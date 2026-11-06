"""The body, plane and custom actions."""
import math

import build123d as bd

from .. import geometry as g
from .. import saved
from ..model import StepError, builtin
from ..schema import InvalidInput, check_object

BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)


@builtin("body")
def body(m, name, shape, size=None, radius=None, diameter=None, top_diameter=None, height=None, at=None, on=None):
    if shape in ("box", "rounded_box"):
        solid = bd.Box(*size, align=BOTTOM)
        if shape == "rounded_box":
            if radius * 2 >= min(size):
                raise StepError("invalid_geometry", "The edge radius must be less than half the smallest size")
            solid = solid.fillet(radius, solid.edges())
    elif shape == "cylinder":
        solid = bd.Cylinder(diameter / 2, height, align=BOTTOM)
    elif shape == "cone":
        solid = bd.Cone(diameter / 2, top_diameter / 2, height, align=BOTTOM)
    else:
        solid = bd.Sphere(diameter / 2, align=BOTTOM)
    if on is not None:
        plane, _, _ = m.resolve_plane(on)
        origin = g.project(at if at is not None else plane.origin, plane.origin, plane.z_dir)
        solid = bd.Plane(origin=origin, x_dir=plane.x_dir, z_dir=plane.z_dir).location * solid
    else:
        solid = bd.Pos(*(at or (0, 0, 0))) * solid
    m.parts[name] = solid
    return {}


@builtin("plane")
def plane(m, name, method, reference=None, distance=0, about=None, angle=None, between=None, points=None):
    if method == "offset":
        base, _, _ = m.resolve_plane(reference)
        result = base.offset(distance)
    elif method == "angle":
        base, _, _ = m.resolve_plane(reference)
        _, edges = m.resolve_edges(about)
        if len(edges) != 1 or edges[0].geom_type != bd.GeomType.LINE:
            raise StepError("invalid_input", "about must select exactly one straight edge")
        edge = edges[0]
        axis = (edge.end_point() - edge.start_point()).normalized()
        z = g.rotate(base.z_dir, axis, angle)
        x = (axis - z * axis.dot(z)).normalized()
        result = bd.Plane(origin=edge.center(), x_dir=x, z_dir=z)
    elif method == "midplane":
        a, _, _ = m.resolve_plane(between[0])
        b, _, _ = m.resolve_plane(between[1])
        tilt = g.angle(a.z_dir, b.z_dir)
        if min(tilt, math.pi - tilt) > g.ANGLE_MATCH:
            raise StepError("invalid_input", "The two faces are not parallel")
        result = bd.Plane(origin=(a.origin + b.origin) * 0.5, x_dir=a.x_dir, z_dir=a.z_dir)
    else:
        a, b, c = (g.vec(p) for p in points)
        normal = (b - a).cross(c - a)
        if normal.length < 1e-9:
            raise StepError("invalid_input", "The three points lie on one line")
        result = bd.Plane(origin=a, x_dir=b - a, z_dir=normal)
    m.datums[name] = result
    return {}


@builtin("custom")
def custom(m, name, fn=None, action=None, **inputs):
    if (fn is None) == (action is None):
        raise StepError("invalid_input", "A custom step needs exactly one of fn= (a function in this script) "
                        "or action= (a saved action as id@version)")
    if action is not None:
        record, fn = saved.resolve(action)
        try:
            inputs = check_object(record["inputs"], inputs)
        except InvalidInput as error:
            raise StepError("invalid_input", str(error)) from None
    created = fn(m, **inputs)
    if created is None:
        return {}
    if not isinstance(created, dict):
        raise StepError("invalid_input", "A custom step returns None or a dict of names to faces")
    out = {}
    for key, faces in created.items():
        faces = list(faces) if isinstance(faces, (list, tuple, bd.ShapeList)) else [faces]
        owner = next((label for label, part in m.parts.items()
                      if all(any(f == pf for pf in part.faces()) for f in faces)), None)
        if owner is None:
            raise StepError("invalid_input", f"The faces named {key!r} do not belong to one part")
        out[str(key)] = (owner, faces)
    return out
