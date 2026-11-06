"""The inspection record: exact measurements of a build's parts and faces, from OCCT.

Written beside facts.json as inspect.json. The viewer picks faces and shows values from it, and the
agent reads it with inspect_get; nothing shown to a person is measured on the mesh.
"""
import math

import build123d as bd
from OCP.BRepAdaptor import BRepAdaptor_Surface

MAX_FACES = 20000
MAX_THICKNESS_FACES = 4000
TYPES = {"PLANE": "plane", "CYLINDER": "cylinder", "CONE": "cone", "SPHERE": "sphere", "TORUS": "torus"}


def _r(value, digits=6):
    return round(float(value), digits)


def _v(vector):
    return [_r(vector.X), _r(vector.Y), _r(vector.Z)]


def _box(shape):
    box = shape.bounding_box()
    return {"min": _v(box.min), "max": _v(box.max)}


def _children(shape):
    return list(getattr(shape, "children", None) or []) or [shape]


def _face_entry(face, index, part_index, part):
    kind = TYPES.get(face.geom_type.name, "other")
    centre = face.center()
    entry = {"index": index, "part": part_index, "type": kind, "area": _r(face.area),
             "center": _v(centre), "bbox": _box(face)}
    surface = BRepAdaptor_Surface(face.wrapped)
    if kind == "plane":
        normal = face.normal_at(centre)
        entry["plane"] = {"origin": _v(centre), "normal": _v(normal)}
    elif kind == "cylinder":
        cylinder = surface.Cylinder()
        axis = cylinder.Axis()
        entry["cylinder"] = {"origin": _v(bd.Vector(axis.Location())), "axis": _v(bd.Vector(axis.Direction())),
                             "radius": _r(cylinder.Radius())}
    elif kind == "cone":
        cone = surface.Cone()
        axis = cone.Axis()
        entry["cone"] = {"origin": _v(bd.Vector(axis.Location())), "axis": _v(bd.Vector(axis.Direction())),
                         "half_angle_deg": _r(math.degrees(cone.SemiAngle()))}
    elif kind == "sphere":
        sphere = surface.Sphere()
        entry["sphere"] = {"center": _v(bd.Vector(sphere.Location())), "radius": _r(sphere.Radius())}
    elif kind == "torus":
        torus = surface.Torus()
        entry["torus"] = {"major": _r(torus.MajorRadius()), "minor": _r(torus.MinorRadius())}
    return entry


def _thickness(part, entry):
    """Distance through the part from a planar face's centre, along the inward normal."""
    normal = bd.Vector(*entry["plane"]["normal"])
    start = bd.Vector(*entry["center"]) - normal * 1e-4
    hits = part.find_intersection_points(bd.Axis(start, -normal))
    ahead = [(p - start).dot(-normal) for p, _ in hits]
    ahead = [t for t in ahead if t > 1e-6]
    return _r(min(ahead) + 1e-4) if ahead else None


def _is_hole_wall(face, entry):
    """A cylinder face is a hole wall when its surface normal points toward its axis (material outside)."""
    origin = bd.Vector(*entry["cylinder"]["origin"])
    axis = bd.Vector(*entry["cylinder"]["axis"]).normalized()
    point = face.position_at(0.5, 0.5)
    radial = (point - origin) - axis * (point - origin).dot(axis)
    return face.normal_at(point).dot(radial) < 0


def _holes(part, part_index, entries, faces):
    walls = [(e, f) for e, f in zip(entries, faces, strict=True) if e["type"] == "cylinder" and _is_hole_wall(f, e)]
    groups = []
    for entry, face in walls:
        axis = bd.Vector(*entry["cylinder"]["axis"]).normalized()
        origin = bd.Vector(*entry["cylinder"]["origin"])
        for group in groups:
            gaxis, gorigin, radius = group["_axis"], group["_origin"], group["_radius"]
            offset = (origin - gorigin) - gaxis * (origin - gorigin).dot(gaxis)
            if abs(abs(axis.dot(gaxis)) - 1) < 1e-9 and offset.length < 1e-6 and abs(radius - entry["cylinder"]["radius"]) < 1e-6:
                group["faces"].append((entry, face))
                break
        else:
            groups.append({"_axis": axis, "_origin": origin, "_radius": entry["cylinder"]["radius"], "faces": [(entry, face)]})
    holes = []
    for group in groups:
        axis, origin, radius = group["_axis"], group["_origin"], group["_radius"]
        ts = [(bd.Vector(v) - origin).dot(axis) for _, face in group["faces"] for v in face.vertices()]
        low, high = min(ts), max(ts)
        disk = math.pi * radius ** 2

        def has_floor(t, axis=axis, origin=origin, disk=disk):
            for e in entries:
                if e["type"] != "plane" or abs(abs(bd.Vector(*e["plane"]["normal"]).dot(axis)) - 1) > 1e-9:
                    continue
                c = bd.Vector(*e["center"])
                along = (c - origin).dot(axis)
                off_axis = ((c - origin) - axis * along).length
                if abs(along - t) < 1e-6 and off_axis < 1e-6 and abs(e["area"] - disk) < disk * 0.01:
                    return True
            return False

        floors = has_floor(low) or has_floor(high)
        holes.append({"part": part_index, "faces": [e["index"] for e, _ in group["faces"]],
                      "diameter": _r(radius * 2), "axis": {"origin": _v(origin + axis * low), "direction": _v(axis)},
                      "depth": _r(high - low), "through": not floors})
    return holes


def inspect_record(shape, module, max_faces=MAX_FACES):
    record = {"version": 1, "units": "mm", "warnings": [], "parts": [], "faces": [], "holes": [],
              "faces_truncated": False}
    parts = _children(shape)
    for i, part in enumerate(parts):
        record["parts"].append({"index": i, "label": (part.label or "")[:120], "volume": _r(part.volume),
                                "area": _r(part.area), "bbox": _box(part),
                                "center_of_mass": _v(part.center(bd.CenterOf.MASS))})
    if sum(len(p.faces()) for p in parts) > max_faces:
        record["faces_truncated"] = True
        record["warnings"].append(f"More than {max_faces} faces: only part measurements are recorded")
        return record
    index = 0
    measured = 0
    for part_index, part in enumerate(parts):
        faces = part.faces()
        entries = []
        for face in faces:
            entry = _face_entry(face, index, part_index, part)
            if entry["type"] == "plane" and measured < MAX_THICKNESS_FACES:
                measured += 1
                thickness = _thickness(part, entry)
                if thickness is not None:
                    entry["thickness"] = thickness
            entries.append(entry)
            index += 1
        record["faces"].extend(entries)
        record["holes"].extend(_holes(part, part_index, entries, faces))
    return record
