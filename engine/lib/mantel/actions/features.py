"""The extrude, hole, fillet, chamfer, text, combine and move actions."""
import math

import build123d as bd
from OCP.Font import Font_FontAspect, Font_FontMgr, Font_StrictLevel
from OCP.TCollection import TCollection_AsciiString

from .. import geometry as g
from ..model import StepError, builtin

BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)
CLEAR = 0.01  # tools start this far outside the face so booleans never meet it exactly


def _new_faces(before, after):
    """Faces of `after` that did not exist, even in part, on `before`."""
    old = [g.signature(f) for f in before.faces()] if before is not None else []
    return [f for f in after.faces() if not any(g.matches(f, s) for s in old)]


def _sketch_plane(plane, at, rotation=0):
    origin = g.project(at if at is not None else plane.origin, plane.origin, plane.z_dir)
    x = g.rotate(plane.x_dir, plane.z_dir, rotation)
    return bd.Plane(origin=origin, x_dir=x, z_dir=plane.z_dir)


def _through(shape):
    return shape.bounding_box().diagonal * 2 + 1


def _depth_to(m, up_to, origin, direction):
    plane, _, _ = m.resolve_plane(up_to)
    distance = (g.vec(plane.origin) - g.vec(origin)).dot(g.vec(direction))
    if distance <= 0:
        raise StepError("invalid_input", "up_to must lie ahead of the starting face")
    return distance


def _cut(m, label, tool):
    before = m.parts[label]
    after = before - tool
    if abs(after.volume - before.volume) < 1e-6:
        raise StepError("missed_target", f"The cut does not reach {label}")
    m.parts[label] = after
    return before, after


def _join(m, label, tool):
    before = m.parts[label]
    after = before + tool
    if len(after.solids()) > len(before.solids()):
        raise StepError("missed_target", f"The new material does not touch {label}")
    m.parts[label] = after
    return before, after


@builtin("extrude")
def extrude(m, name, on, profile, width=None, length=None, radius=None, diameter=None, sides=None, at=None,
            rotation=0, extent="distance", distance=None, up_to=None, taper=0, operation="join", target=None):
    plane, owner, _ = m.resolve_plane(on)
    label = m.resolve_part(target) if target is not None else owner
    if label is None and operation != "new":
        raise StepError("invalid_input", "target is required when extruding from a construction plane")
    if profile == "rectangle":
        sketch = bd.Rectangle(width, length)
    elif profile == "rounded_rectangle":
        if radius * 2 >= min(width, length):
            raise StepError("invalid_geometry", "The corner radius must be less than half the smaller side")
        sketch = bd.RectangleRounded(width, length, radius)
    elif profile == "circle":
        sketch = bd.Circle(diameter / 2)
    elif profile == "slot":
        sketch = bd.SlotOverall(max(width, length), min(width, length), rotation=0 if width >= length else 90)
    else:
        sketch = bd.RegularPolygon(diameter / 2, sides)
    place = _sketch_plane(plane, at, rotation)
    z = g.vec(place.z_dir)
    both = extent == "symmetric"
    if extent in ("distance", "symmetric"):
        if distance == 0:
            raise StepError("invalid_input", "distance must not be 0")
        amount, direction = abs(distance), (z if distance > 0 else -z)
    elif extent == "through":
        if operation != "cut":
            raise StepError("invalid_input", "extent through only applies to cuts")
        amount, direction = _through(m.parts[label]), -z
    else:
        span = (g.vec(m.resolve_plane(up_to)[0].origin) - g.vec(place.origin)).dot(z)
        if abs(span) < 1e-6:
            raise StepError("invalid_input", "up_to lies on the starting face")
        amount, direction = abs(span), (z if span > 0 else -z)
    start = place.offset(CLEAR if operation == "cut" and not both else 0)
    face = start * sketch
    tool = bd.extrude(face, amount=amount + (CLEAR if operation == "cut" and not both else 0),
                      dir=direction, taper=taper, both=both)
    if operation == "new":
        m.parts[name] = tool
        before, after = None, tool
    elif operation == "cut":
        before, after = _cut(m, label, tool)
    else:
        before, after = _join(m, label, tool)
    fresh = _new_faces(before, after)
    far = g.vec(place.origin) + direction * amount
    ends = [f for f in fresh if g.is_plane(f) and abs((g.vec(f.center()) - far).dot(z)) < 1e-3]
    sides = [f for f in fresh if not any(f == e for e in ends)]
    owner_label = name if operation == "new" else label
    return {"end": (owner_label, ends), "sides": (owner_label, sides)}


@builtin("hole")
def hole(m, name, on, diameter, at=None, extent="distance", depth=None, up_to=None, kind="simple",
         cb_diameter=None, cb_depth=None, cs_diameter=None, cs_angle=90):
    label, faces = m.resolve_faces(on)
    try:
        plane = g.plane_of(faces)
    except g.GeometryError as error:
        raise StepError(error.code, str(error)) from None
    widest = max(diameter, cb_diameter or 0, cs_diameter or 0)
    extents = sorted(max(f.bounding_box().size) for f in faces)
    face_span = min(sorted(faces[0].bounding_box().size)[1:]) if len(faces) == 1 else extents[-1]
    if widest > face_span:
        raise StepError("too_large", f"A {widest} mm hole does not fit on a face {face_span:.1f} mm across")
    if kind == "counterbore" and cb_diameter <= diameter:
        raise StepError("invalid_input", "cb_diameter must be larger than diameter")
    if kind == "countersink" and cs_diameter <= diameter:
        raise StepError("invalid_input", "cs_diameter must be larger than diameter")
    centre = g.project(at if at is not None else plane.origin, plane.origin, plane.z_dir)
    if min(f.distance_to(centre) for f in faces) > 1e-3:
        raise StepError("missed_target", "at is not on the selected face")
    inward = -g.vec(plane.z_dir)
    if extent == "through":
        length = _through(m.parts[label])
    elif extent == "up_to":
        length = _depth_to(m, up_to, centre, inward)
    else:
        length = depth
    drill = bd.Plane(origin=centre, x_dir=plane.x_dir, z_dir=inward)
    tool = drill.offset(-CLEAR).location * bd.Cylinder(diameter / 2, length + CLEAR, align=BOTTOM)
    if kind == "counterbore":
        if cb_depth >= length:
            raise StepError("invalid_input", "cb_depth must be less than the hole depth")
        tool = tool + drill.offset(-CLEAR).location * bd.Cylinder(cb_diameter / 2, cb_depth + CLEAR, align=BOTTOM)
    elif kind == "countersink":
        sink = (cs_diameter - diameter) / 2 / math.tan(math.radians(cs_angle) / 2)
        tool = tool + drill.location * bd.Cone(cs_diameter / 2, diameter / 2, sink, align=BOTTOM)
    before, after = _cut(m, label, tool)
    fresh = _new_faces(before, after)

    def cylinders(radius):
        return [f for f in fresh if f.geom_type == bd.GeomType.CYLINDER and abs(f.radius - radius) < 1e-6]

    created = {"wall": (label, cylinders(diameter / 2))}
    if extent != "through":
        bottom = centre + inward * length
        created["floor"] = (label, [f for f in fresh if g.is_plane(f) and f.distance_to(bottom) < 1e-3
                                    and abs((g.vec(f.center()) - bottom).dot(inward)) < 1e-3])
    if kind == "counterbore":
        created["counterbore_wall"] = (label, cylinders(cb_diameter / 2))
    if kind == "countersink":
        created["countersink"] = (label, [f for f in fresh if f.geom_type == bd.GeomType.CONE])
    return created


def _largest_that_builds(attempt, wanted):
    """Binary search for the largest value in (0, wanted] for which attempt() succeeds."""
    low, high, best = 0.0, wanted, None
    for _ in range(10):
        mid = (low + high) / 2
        result = _try(attempt, mid)
        if result is not None:
            low, best = mid, (mid, result)
        else:
            high = mid
    return best


def _try(attempt, value):
    try:
        result = attempt(value)
    except Exception:  # noqa: BLE001 - OCCT reports an impossible fillet as an exception
        return None
    return result if result.is_valid and result.solids() else None


@builtin("fillet")
def fillet(m, name, edges, radius):
    label, chosen = m.resolve_edges(edges)
    before = m.parts[label]
    after = _try(lambda r: before.fillet(r, chosen), radius)
    if after is None:
        found = _largest_that_builds(lambda r: before.fillet(r, chosen), radius)
        if found is None:
            raise StepError("invalid_geometry", "These edges cannot be rounded")
        used, after = found
        m.warn(f"Radius reduced from {radius} mm to {used:.2f} mm, the largest these edges allow")
    m.parts[label] = after
    return {"rounds": (label, _new_faces(before, after))}


@builtin("chamfer")
def chamfer(m, name, edges, distance, angle=45):
    label, chosen = m.resolve_edges(edges)
    before = m.parts[label]
    second = None if abs(angle - 45) < 1e-9 else distance * math.tan(math.radians(angle))
    after = _try(lambda d: before.chamfer(d, second, chosen), distance)
    if after is None:
        raise StepError("invalid_geometry", "These edges cannot be bevelled by that distance")
    m.parts[label] = after
    return {"bevels": (label, _new_faces(before, after))}


def _font(name):
    family, bold = (name[:-5], True) if name.endswith(" Bold") else (name, False)
    aspect = Font_FontAspect.Font_FontAspect_Bold if bold else Font_FontAspect.Font_FontAspect_Regular
    manager = Font_FontMgr.GetInstance_s()
    manager.InitFontDataBase()
    if manager.FindFont(TCollection_AsciiString(family), Font_StrictLevel.Font_StrictLevel_Strict, aspect, False) is None:
        raise StepError("font_missing", f"{name} is not installed in the build image")
    return family, bd.FontStyle.BOLD if bold else bd.FontStyle.REGULAR


@builtin("text")
def text(m, name, on, text, height, depth, font="Liberation Sans", mode="engrave", at=None, align="center",
         rotation=0):
    label, faces = m.resolve_faces(on)
    try:
        plane = g.plane_of(faces)
    except g.GeometryError as error:
        raise StepError(error.code, str(error)) from None
    family, style = _font(font)
    horizontal = {"left": bd.Align.MIN, "center": bd.Align.CENTER, "right": bd.Align.MAX}[align]
    letters = bd.Text(text, font_size=height, font=family, font_style=style, align=(horizontal, bd.Align.CENTER))
    place = _sketch_plane(plane, at, rotation)
    z = g.vec(place.z_dir)
    if mode == "engrave":
        tool = bd.extrude(place.offset(CLEAR) * letters, amount=depth + CLEAR, dir=-z)
        try:
            before, after = _cut(m, label, tool)
        except StepError:
            raise StepError("too_large", "The text does not land on the face") from None
    else:
        tool = bd.extrude(place.offset(-CLEAR) * letters, amount=depth + CLEAR, dir=z)
        before, after = _join(m, label, tool)
    size = letters.bounding_box().size
    span = sorted(sum((f.bounding_box().size for f in faces[1:]), faces[0].bounding_box().size))
    if max(size.X, size.Y) > span[-1] + 1e-6 or min(size.X, size.Y) > span[-2] + 1e-6:
        m.warn("The text runs past the face")
    m.lettering.append({"name": name, "part": label, "text": text, "font": font, "height": float(height),
                        "depth": float(depth), "method": mode})
    return {"text_faces": (label, _new_faces(before, after))}


@builtin("combine")
def combine(m, name, target, tool, operation, keep_tool=False):
    a, b = m.resolve_part(target), m.resolve_part(tool)
    if a == b:
        raise StepError("invalid_input", "target and tool must be different parts")
    shaper = m.parts[b]
    if operation == "cut":
        _cut(m, a, shaper)
    elif operation == "join":
        before = m.parts[a]
        after = before + shaper
        if len(after.solids()) >= len(before.solids()) + len(shaper.solids()):
            raise StepError("missed_target", f"{b} does not touch {a}")
        m.parts[a] = after
    else:
        after = m.parts[a] & shaper
        if not after.solids() or after.volume < 1e-6:
            raise StepError("missed_target", f"{a} and {b} do not overlap")
        m.parts[a] = after
    if not keep_tool:
        del m.parts[b]
    return {}


@builtin("move")
def move(m, name, part, method, by=None, axis=None, angle=None, origin=None, face=None, to=None, offset=0):
    label = m.resolve_part(part)
    shape = m.parts[label]
    if method == "translate":
        moved = bd.Pos(*by) * shape
    elif method == "rotate":
        direction = {"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}[axis]
        moved = shape.rotate(bd.Axis(tuple(origin or (0, 0, 0)), direction), angle)
    else:
        owner, faces = m.resolve_faces(face)
        if owner != label:
            raise StepError("invalid_input", f"face must belong to {label}")
        try:
            mine = g.plane_of(faces)
        except g.GeometryError as error:
            raise StepError(error.code, str(error)) from None
        goal, _, _ = m.resolve_plane(to)
        n, want = g.vec(mine.z_dir), -g.vec(goal.z_dir)
        turn = math.degrees(g.angle(n, want))
        moved = shape
        if turn > 1e-6:
            spin = n.cross(want)
            spin = spin if spin.length > 1e-9 else g.vec(mine.x_dir)
            moved = moved.rotate(bd.Axis(tuple(mine.origin), tuple(spin.normalized())), turn)
        centre = g.vec(mine.origin)
        landing = g.project(centre, goal.origin, goal.z_dir) + g.vec(goal.z_dir).normalized() * offset
        moved = bd.Pos(*(landing - centre)) * moved
    m.parts[label] = moved
    return {}
