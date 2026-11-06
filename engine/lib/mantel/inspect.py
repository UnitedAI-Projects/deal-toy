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
        return complete(record, shape, module, None)
    all_faces = []
    index = 0
    measured = 0
    from . import geometry as g
    from .model import created_names, last_model

    model = last_model() if module is not None else None
    names = created_names(model) if model is not None else []
    for part_index, part in enumerate(parts):
        faces = part.faces()
        sides = {side: g.side_faces(part, side) for side in g.SIDES} if model is not None or module is not None else {}
        entries = []
        for face in faces:
            entry = _face_entry(face, index, part_index, part)
            named = [{"of": step, "name": name} for step, name, label, signatures in names
                     if label == part.label and any(g.matches(face, s) for s in signatures)]
            if named:
                entry["names"] = named
            on_sides = [side for side, picked in sides.items() if any(face == f for f in picked)]
            if on_sides:
                entry["sides"] = on_sides
            if entry["type"] == "plane" and measured < MAX_THICKNESS_FACES:
                measured += 1
                thickness = _thickness(part, entry)
                if thickness is not None:
                    entry["thickness"] = thickness
            entries.append(entry)
            index += 1
        record["faces"].extend(entries)
        record["holes"].extend(_holes(part, part_index, entries, faces))
        all_faces.extend(faces)
    return complete(record, shape, module, all_faces)


MAX_PAIRED_PARTS = 30


def _pairs(parts, record):
    if len(parts) > MAX_PAIRED_PARTS:
        record["warnings"].append(f"Only the first {MAX_PAIRED_PARTS} parts are measured against each other")
    out = []
    count = min(len(parts), MAX_PAIRED_PARTS)
    for i in range(count):
        for j in range(i + 1, count):
            a, b = parts[i], parts[j]
            distance = a.distance_to(b)
            overlap = 0.0
            if distance < 1e-9:
                common = a & b
                overlap = sum(s.volume for s in common.solids()) if common is not None else 0.0
            out.append({"a": i, "b": j, "distance": _r(distance), "overlap_volume": _r(overlap)})
    return out


def _dimensions(shape, module, faces, record):
    declare = getattr(module, "dimensions", None)
    if not callable(declare):
        return []
    try:
        declared = declare(shape) or []
    except Exception as error:  # noqa: BLE001 - a broken declaration is a warning, not a failed build
        record["warnings"].append(f"dimensions() failed: {type(error).__name__}: {error}"[:300])
        return []
    params = getattr(module, "PARAMS", None) or {}

    def index_of(face):
        return next((i for i, f in enumerate(faces) if f == face), None)

    out = []
    for item in list(declared)[:200]:
        try:
            name = str(item["name"])[:120]
            first, second = item["between"]
            ia, ib = index_of(first), index_of(second)
            if ia is None or ib is None:
                raise ValueError("a face is not part of the built model")
            ea, eb = record["faces"][ia], record["faces"][ib]
            if ea["type"] == eb["type"] == "plane" and abs(
                    abs(bd.Vector(*ea["plane"]["normal"]).dot(bd.Vector(*eb["plane"]["normal"]))) - 1) < 1e-9:
                value = abs((bd.Vector(*eb["center"]) - bd.Vector(*ea["center"])).dot(bd.Vector(*ea["plane"]["normal"])))
            else:
                value = first.distance_to(second)
            entry = {"name": name, "value": _r(value), "faces": [ia, ib], "scale": float(item.get("scale", 1)),
                     "matches_param": False}
            if "moves" in item:
                entry["moves"] = index_of(item["moves"])
            param = item.get("param")
            if param is not None:
                entry["param"] = str(param)
                spec = params.get(param)
                if isinstance(spec, dict) and isinstance(spec.get("value"), (int, float)):
                    entry["matches_param"] = abs(value - spec["value"] * entry["scale"]) < 1e-3
            out.append(entry)
        except Exception as error:  # noqa: BLE001
            record["warnings"].append(f"Dimension {item.get('name', '?')!r} was not recorded: {error}"[:300])
    return out


def _materials(module, record):
    declared = getattr(module, "MATERIALS", None) or {}
    out = {}
    for label, spec in list(declared.items())[:500] if isinstance(declared, dict) else []:
        density = spec.get("density_g_cm3") if isinstance(spec, dict) else None
        if isinstance(density, (int, float)) and density > 0:
            out[str(label)[:120]] = {"name": str(spec.get("name", ""))[:80], "density_g_cm3": float(density)}
        else:
            record["warnings"].append(f"MATERIALS[{label!r}] needs a positive density_g_cm3")
    return out


def _outer_solid(part):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid

    shells = part.shells()
    outer = max(shells, key=lambda s: s.bounding_box().diagonal)
    return outer, bd.Solid(BRepBuilderAPI_MakeSolid(outer.wrapped).Solid())


def _embeds(parts, module, record):
    declared = getattr(module, "EMBEDS", None) or []
    labels = [p.label for p in parts]
    out = []
    for item in list(declared)[:100]:
        try:
            embed, host = labels.index(item["part"]), labels.index(item["in"])
        except (KeyError, TypeError, ValueError):
            record["warnings"].append(f"Embed {item!r} names a part that is not in the model"[:300])
            continue
        shell, solid = _outer_solid(parts[host])
        inside = parts[embed] & solid
        inside_volume = sum(s.volume for s in inside.solids()) if inside is not None else 0.0
        out.append({"part": embed, "in": host,
                    "contained": abs(inside_volume - parts[embed].volume) <= max(1e-6, parts[embed].volume * 1e-6),
                    "wall": _r(parts[embed].distance_to(shell))})
    return out


def _hull(points):
    points = sorted(set(points))
    if len(points) < 3:
        return points

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 1e-12:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 1e-12:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _stability(parts, record):
    densities = record.get("materials", {})
    uniform = not all(p.label in densities for p in parts)
    weights = [p.volume * (1 if uniform else densities[p.label]["density_g_cm3"]) for p in parts]
    total = sum(weights)
    if total <= 0:
        return None
    com = [sum(w * getattr(p.center(bd.CenterOf.MASS), axis) for w, p in zip(weights, parts, strict=True)) / total
           for axis in "XYZ"]
    floor = min(p.bounding_box().min.Z for p in parts)
    down = bd.Vector(0, 0, -1)
    points = []
    for p in parts:
        for f in p.faces():
            if f.geom_type == bd.GeomType.PLANE and f.normal_at().dot(down) > math.cos(math.radians(1)) \
                    and abs(f.center().Z - floor) < 0.01:
                points.extend((round(v.X, 9), round(v.Y, 9)) for v in (bd.Vector(x) for x in f.vertices()))
    hull = _hull(points)
    height = com[2] - floor
    result = {"center_of_mass": [_r(c) for c in com], "uniform_density": uniform,
              "footprint": [[_r(x), _r(y)] for x, y in hull], "tip_angle_deg": 0.0, "tip_direction": [0.0, 0.0]}
    if len(hull) < 3 or height <= 0:
        return result
    best = None
    for k in range(len(hull)):
        (x1, y1), (x2, y2) = hull[k], hull[(k + 1) % len(hull)]
        ex, ey = x2 - x1, y2 - y1
        length = math.hypot(ex, ey)
        outward = (ey / length, -ex / length)  # hull is counter-clockwise, so the right-hand normal points out
        inside = -((com[0] - x1) * outward[0] + (com[1] - y1) * outward[1])
        if best is None or inside < best[0]:
            best = (inside, outward)
    if best[0] > 0:
        result["tip_angle_deg"] = _r(math.degrees(math.atan2(best[0], height)))
        result["tip_direction"] = [_r(best[1][0]), _r(best[1][1])]
    return result


def complete(record, shape, module, faces):
    """Adds the whole-model measurements to a record built by inspect_record."""
    parts = _children(shape)
    labels = [p.label for p in parts]
    for label in sorted({x for x in labels if labels.count(x) > 1}):
        record["warnings"].append(f'Two parts are labelled "{label}"')
    record["pairs"] = _pairs(parts, record)
    record["materials"] = _materials(module, record)
    record["embeds"] = _embeds(parts, module, record)
    record["dimensions"] = _dimensions(shape, module, faces, record) if faces is not None else []
    record["stability"] = _stability(parts, record)
    return record
