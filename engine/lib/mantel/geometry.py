"""Face signatures, side lookup and planes, shared by the step runner and the actions."""
import math
from dataclasses import dataclass

import build123d as bd

ANGLE_MATCH = math.radians(0.5)
ANGLE_QUERY = math.radians(1.0)
DISTANCE = 0.01
TIE = 0.5
SIDES = {"top": (0, 0, 1), "bottom": (0, 0, -1), "left": (-1, 0, 0), "right": (1, 0, 0),
         "front": (0, -1, 0), "back": (0, 1, 0)}


class GeometryError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def vec(v):
    return v if isinstance(v, bd.Vector) else bd.Vector(*v)


def angle(a, b):
    a, b = vec(a).normalized(), vec(b).normalized()
    return math.acos(max(-1.0, min(1.0, a.dot(b))))


def normal(face):
    return face.normal_at()


def is_plane(face):
    return face.geom_type == bd.GeomType.PLANE


@dataclass(frozen=True)
class Signature:
    """What identifies a created face across later steps: its surface and the region it covered."""
    kind: str
    point: tuple
    direction: tuple | None
    radius: float | None
    low: tuple
    high: tuple

    def covers(self, point):
        return all(lo - DISTANCE <= p <= hi + DISTANCE for p, lo, hi in zip(point, self.low, self.high))


def signature(face):
    box = face.bounding_box()
    kind = face.geom_type.name
    point, direction, radius = tuple(face.center()), None, None
    if kind == "PLANE":
        direction = tuple(normal(face))
    elif kind == "CYLINDER":
        axis = face.axis_of_rotation
        point, direction, radius = tuple(axis.position), tuple(axis.direction), face.radius
    return Signature(kind, point, direction, radius, tuple(box.min), tuple(box.max))


def matches(face, sig):
    if face.geom_type.name != sig.kind or not sig.covers(tuple(face.center())):
        return False
    if sig.kind == "PLANE":
        n = normal(face)
        offset = abs((vec(face.center()) - vec(sig.point)).dot(vec(sig.direction)))
        return angle(n, sig.direction) < ANGLE_MATCH and offset < DISTANCE
    if sig.kind == "CYLINDER":
        axis = face.axis_of_rotation
        parallel = min(angle(axis.direction, sig.direction), math.pi - angle(axis.direction, sig.direction))
        d = vec(sig.direction).normalized()
        gap = vec(axis.position) - vec(sig.point)
        off_axis = (gap - d * gap.dot(d)).length
        return parallel < ANGLE_MATCH and off_axis < DISTANCE and abs(face.radius - sig.radius) < DISTANCE
    return True


def side_faces(shape, side):
    direction = vec(SIDES[side])
    faces = [f for f in shape.faces() if is_plane(f) and angle(normal(f), direction) < ANGLE_QUERY]
    if not faces:
        return []
    far = max(vec(f.center()).dot(direction) for f in faces)
    return [f for f in faces if far - vec(f.center()).dot(direction) < DISTANCE]


def query_face(shape, wanted_normal, near):
    near = vec(near)
    faces = [f for f in shape.faces() if angle(normal(f), wanted_normal) < ANGLE_QUERY]
    ranked = sorted(faces, key=lambda f: (vec(f.center()) - near).length)
    if not ranked:
        return []
    if len(ranked) > 1:
        first, second = ((vec(f.center()) - near).length for f in ranked[:2])
        if second - first < TIE:
            raise GeometryError("ambiguous_reference",
                                f"Two faces are within {TIE} mm of equally near; move the reference point")
    return ranked[:1]


def frame_x(z):
    """A horizontal-first x direction, flipped so text on vertical faces reads upright."""
    z = vec(z).normalized()
    x = bd.Vector(1, 0, 0) - z * z.X
    if x.length < 1e-6:
        x = bd.Vector(0, 1, 0) - z * z.Y
    x = x.normalized()
    if z.cross(x).Z < -1e-6:
        x = -x
    return x


def plane_of(faces):
    if not faces or not all(is_plane(f) for f in faces):
        raise GeometryError("not_planar", "This needs a flat face or a construction plane")
    n = normal(faces[0])
    for f in faces[1:]:
        if angle(normal(f), n) > ANGLE_MATCH:
            raise GeometryError("not_planar", "The selected faces are not one flat face")
    box = bd.Compound(children=[f for f in faces]).bounding_box() if len(faces) > 1 else faces[0].bounding_box()
    origin = project(box.center(), vec(faces[0].center()), n)
    return bd.Plane(origin=origin, x_dir=frame_x(n), z_dir=n)


def project(point, origin, n):
    point, n = vec(point), vec(n).normalized()
    return point - n * (point - vec(origin)).dot(n)


def rotate(v, axis, degrees):
    """Rodrigues rotation of v about a unit axis."""
    v, k, t = vec(v), vec(axis).normalized(), math.radians(degrees)
    return v * math.cos(t) + k.cross(v) * math.sin(t) + k * (k.dot(v) * (1 - math.cos(t)))
