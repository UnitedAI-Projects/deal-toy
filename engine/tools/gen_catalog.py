"""Generates the built-in action catalog, engine/lib/mantel/catalog.json.

Run from the repository root, then format:
    python3 -I engine/tools/gen_catalog.py engine/lib/mantel/catalog.json && npx prettier --write engine/lib/mantel/catalog.json
The catalog is the single source of every built-in action's description; edit this file, not the JSON.
"""
import json
import sys


def num(desc, unit, lo, hi, **kw):
    return {"type": "number", "description": desc, "unit": unit, "minimum": lo, "maximum": hi, **kw}


def integer(desc, lo, hi, **kw):
    return {"type": "integer", "description": desc, "unit": "count", "minimum": lo, "maximum": hi, **kw}


def vec3(desc, lo=-2000, hi=2000, unit="mm"):
    return {"type": "array", "description": desc, "minItems": 3, "maxItems": 3,
            "items": num("One coordinate", unit, lo, hi)}


def ref(kinds, desc):
    return {"x-ref": kinds if isinstance(kinds, str) else list(kinds), "description": desc}


def enum(values, desc, **kw):
    return {"type": "string", "enum": values, "description": desc, **kw}


def when(field, value, required):
    return {"if": {"properties": {field: {"const": value}}}, "then": {"required": required}}


def obj(props, required, conditions=(), extra=False):
    schema = {"type": "object", "properties": props, "required": required,
              "additionalProperties": extra}
    if conditions:
        schema["allOf"] = list(conditions)
    return schema


F = {
    "face_not_found": ("A face this step refers to no longer exists, often after an earlier step or a parameter changed.",
                       "Pick the face again, or refer to a name an earlier step created."),
    "ambiguous_reference": ("A face or edge query matched two candidates equally well, so the step refused to guess.",
                            "Move the reference point closer to the intended face, or pick it by a created name."),
    "part_not_found": ("No part has the label this step refers to.", "Check the part label in the model summary."),
    "datum_not_found": ("No construction plane has that name.", "Use the name of an earlier plane step."),
    "invalid_input": ("An input is missing, has the wrong type or is out of range.", "Read the action's inputs with actions_describe and correct the value."),
    "invalid_geometry": ("The operation produced geometry that is not a valid solid.", "Try a smaller size or a different face; check the step's inputs against the part's size."),
    "duplicate_name": ("Another step or part already uses this name.", "Give the step a unique name."),
    "internal_error": ("The step raised an unexpected error.", "Read the message; if it persists, simplify the inputs or use a custom step."),
    "not_planar": ("The selected face is curved, but this action needs a flat face or a construction plane.", "Pick a flat face or a plane."),
    "too_large": ("The feature does not fit on the selected face.", "Reduce its size or pick a larger face."),
    "missed_target": ("The tool did not touch the target part, so nothing changed.", "Move the tool so it overlaps the target, or check the direction."),
    "no_edges": ("The edge selection matched no edges.", "Pick edges again, or check that the two named faces meet."),
    "font_missing": ("The requested font is not installed in the build image.", "Choose one of the listed fonts."),
    "action_not_found": ("The saved action this step uses is not available to this model: it does not exist, is not ready, or belongs to another project.",
                         "Check the id and version with actions_list, or save the action for this project."),
    "action_rejected": ("The saved action's source could not be loaded.", "Fix the action and save a new version."),
}


def failures(*codes):
    common = ["invalid_input", "duplicate_name", "internal_error"]
    return [{"code": c, "explanation": F[c][0], "fix": F[c][1]} for c in [*codes, *common]]


ON_FACE = ref(["face", "datum"], "The flat face or construction plane to work on")
AT = vec3("A point in model coordinates, projected onto the face; defaults to the face's centre")

extent = {
    "extent": enum(["distance", "symmetric", "through", "up_to"],
                   "How far to go: a distance, a distance split both ways, through the whole part, or up to a face", default="distance"),
    "distance": num("Distance along the face normal; negative goes into the part", "mm", -2000, 2000),
    "up_to": ref("face", "The face to stop at when extent is up_to"),
}

actions = [
    {
        "id": "body", "title": "Body", "category": "Create", "preview": "bodies",
        "summary": "Add a new labelled part from a box, rounded box, cylinder, cone or sphere.",
        "description": "Use for the blocks, bases and plinths a deal toy starts from. The step name becomes the part label, and the part gets named sides (top, bottom, left, right, front, back) for later steps. Do not use it to cut material: use extrude with operation cut, hole, or combine.",
        "inputs": obj({
            "shape": enum(["box", "rounded_box", "cylinder", "cone", "sphere"], "The primitive"),
            "size": vec3("Box size along X, Y and Z", 0.1, 2000),
            "radius": num("Edge radius of a rounded box", "mm", 0.05, 500),
            "diameter": num("Diameter of a cylinder or sphere, or the bottom diameter of a cone", "mm", 0.1, 2000),
            "top_diameter": num("Top diameter of a cone; 0 makes a point", "mm", 0, 2000),
            "height": num("Height of a cylinder or cone", "mm", 0.1, 2000),
            "at": vec3("Where the centre of the body's bottom sits, in model coordinates", ),
            "on": ref(["face", "datum"], "Optional face or plane the body stands on; its bottom is placed on it, centred at the projection of at"),
        }, ["shape"], [
            when("shape", "box", ["size"]), when("shape", "rounded_box", ["size", "radius"]),
            when("shape", "cylinder", ["diameter", "height"]), when("shape", "cone", ["diameter", "top_diameter", "height"]),
            when("shape", "sphere", ["diameter"]),
        ]),
        "creates": {},
        "failures": failures("face_not_found", "ambiguous_reference", "datum_not_found", "not_planar", "invalid_geometry"),
        "example": 'm.body("Block", shape="box", size=(80, 30, 60), at=(0, 0, 10))',
    },
    {
        "id": "plane", "title": "Construction plane", "category": "Construct", "preview": "plane",
        "summary": "Add a named construction plane: offset from a face, angled about an edge, midway between faces, or through 3 points.",
        "description": "Use to place features where no face exists, such as text floating on a mid-plane or a cut through the middle of a part. A plane adds no material. Later steps refer to it with m.datum(name).",
        "inputs": obj({
            "method": enum(["offset", "angle", "midplane", "three_points"], "How the plane is defined"),
            "reference": ref(["face", "datum"], "The face or plane to offset or rotate from"),
            "distance": num("Offset along the normal of the reference", "mm", -2000, 2000, default=0),
            "about": ref("edges", "The straight edge to rotate about, for method angle"),
            "angle": num("Rotation about the edge, for method angle", "deg", -180, 180),
            "between": {"type": "array", "description": "The two parallel faces for method midplane", "minItems": 2, "maxItems": 2,
                        "items": ref("face", "One of the two faces")},
            "points": {"type": "array", "description": "Three points for method three_points", "minItems": 3, "maxItems": 3,
                       "items": vec3("A point in model coordinates")},
        }, ["method"], [
            when("method", "offset", ["reference", "distance"]), when("method", "angle", ["reference", "about", "angle"]),
            when("method", "midplane", ["between"]), when("method", "three_points", ["points"]),
        ]),
        "creates": {},
        "failures": failures("face_not_found", "ambiguous_reference", "datum_not_found", "not_planar", "no_edges", "invalid_geometry"),
        "example": 'm.plane("Mid plane", method="midplane", between=[m.face("Base", "left"), m.face("Base", "right")])',
    },
    {
        "id": "extrude", "title": "Extrude", "category": "Create", "preview": "prism",
        "summary": "Extrude a rectangle, rounded rectangle, circle, slot or polygon from a face to add, cut or make a part.",
        "description": "Use for pockets, bosses, slots and recesses with a simple outline. Use hole for round holes with counterbores or countersinks, text for lettering, and combine to cut one existing part from another. Negative distances go into the part.",
        "inputs": obj({
            "on": ON_FACE,
            "profile": enum(["rectangle", "rounded_rectangle", "circle", "slot", "polygon"], "The outline to extrude"),
            "width": num("Profile width along the face's horizontal direction", "mm", 0.1, 2000),
            "length": num("Profile length along the face's vertical direction", "mm", 0.1, 2000),
            "radius": num("Corner radius of a rounded rectangle", "mm", 0.05, 500),
            "diameter": num("Diameter of a circle, or of the circle around a polygon", "mm", 0.1, 2000),
            "sides": integer("Number of polygon sides", 3, 64),
            "at": AT,
            "rotation": num("Rotation of the profile about the face normal", "deg", -360, 360, default=0),
            **extent,
            "taper": num("Draft angle of the side walls; positive narrows away from the face", "deg", -45, 45, default=0),
            "operation": enum(["new", "join", "cut"], "Make a new part named after the step, add to the target, or cut from it", default="join"),
            "target": ref("part", "The part to join to or cut from; defaults to the part that owns the face"),
        }, ["on", "profile"], [
            when("profile", "rectangle", ["width", "length"]), when("profile", "rounded_rectangle", ["width", "length", "radius"]),
            when("profile", "circle", ["diameter"]), when("profile", "slot", ["width", "length"]),
            when("profile", "polygon", ["diameter", "sides"]),
            when("extent", "distance", ["distance"]), when("extent", "symmetric", ["distance"]),
            when("extent", "up_to", ["up_to"]),
        ]),
        "creates": {"end": "The end face opposite the starting face", "sides": "The side walls of the extrusion"},
        "failures": failures("face_not_found", "ambiguous_reference", "datum_not_found", "part_not_found", "not_planar", "missed_target", "invalid_geometry"),
        "example": 'm.extrude("Pocket", on=m.face("Base", "top"), profile="rectangle", width=20, length=10, distance=-3, operation="cut")',
    },
    {
        "id": "hole", "title": "Hole", "category": "Modify", "preview": "cylinder",
        "summary": "Cut a simple, counterbored or countersunk round hole into a face, to a depth, through all or up to a face.",
        "description": "Use for mounting and screw holes. The hole is drilled perpendicular to the face at the point at. For non-round cavities use extrude with operation cut; to make a cavity shaped like another part, use combine.",
        "inputs": obj({
            "on": ref("face", "The flat face the hole is drilled into"),
            "at": AT,
            "diameter": num("Hole diameter", "mm", 0.2, 200),
            "extent": enum(["distance", "through", "up_to"], "How deep to drill", default="distance"),
            "depth": num("Hole depth, for extent distance", "mm", 0.1, 2000),
            "up_to": ref("face", "The face to stop at when extent is up_to"),
            "kind": enum(["simple", "counterbore", "countersink"], "The hole type", default="simple"),
            "cb_diameter": num("Counterbore diameter", "mm", 0.3, 300),
            "cb_depth": num("Counterbore depth", "mm", 0.1, 500),
            "cs_diameter": num("Countersink diameter at the face", "mm", 0.3, 300),
            "cs_angle": num("Countersink included angle", "deg", 60, 120, default=90),
        }, ["on", "diameter"], [
            when("extent", "distance", ["depth"]), when("extent", "up_to", ["up_to"]),
            when("kind", "counterbore", ["cb_diameter", "cb_depth"]), when("kind", "countersink", ["cs_diameter"]),
        ]),
        "creates": {"wall": "The cylindrical wall of the hole", "floor": "The flat bottom of a blind hole",
                    "counterbore_wall": "The wall of the counterbore", "countersink": "The conical countersink face"},
        "failures": failures("face_not_found", "ambiguous_reference", "not_planar", "too_large", "missed_target", "invalid_geometry"),
        "example": 'm.hole("Mount hole", on=m.face("Base", "bottom"), at=(-30, 0, 0), diameter=5, extent="through")',
    },
    {
        "id": "fillet", "title": "Fillet", "category": "Modify", "preview": "none",
        "summary": "Round the selected edges with a radius.",
        "description": "Use to soften the edges of blocks and bases. A radius that is too large for an edge is reduced to the largest that builds, and the step reports a warning. For a flat bevel use chamfer.",
        "inputs": obj({
            "edges": ref("edges", "The edges to round"),
            "radius": num("Fillet radius", "mm", 0.05, 500),
        }, ["edges", "radius"]),
        "creates": {"rounds": "The rounded faces"},
        "failures": failures("face_not_found", "ambiguous_reference", "no_edges", "invalid_geometry"),
        "example": 'm.fillet("Base edges", edges=m.edges("Base", around="top"), radius=1)',
    },
    {
        "id": "chamfer", "title": "Chamfer", "category": "Modify", "preview": "none",
        "summary": "Bevel the selected edges by a distance, optionally at an angle.",
        "description": "Use for flat bevels on edges, such as a lead-in on a hole or a crisp edge on a plaque. For rounded edges use fillet.",
        "inputs": obj({
            "edges": ref("edges", "The edges to bevel"),
            "distance": num("Chamfer distance", "mm", 0.05, 500),
            "angle": num("Chamfer angle from the first face", "deg", 10, 80, default=45),
        }, ["edges", "distance"]),
        "creates": {"bevels": "The bevel faces"},
        "failures": failures("face_not_found", "ambiguous_reference", "no_edges", "invalid_geometry"),
        "example": 'm.chamfer("Base bevel", edges=m.edges("Base", around="top"), distance=1)',
    },
    {
        "id": "text", "title": "Text", "category": "Create", "preview": "text",
        "summary": "Engrave or emboss a line of text on a flat face.",
        "description": "Use for deal names, dates and logos in words. Text reads upright when viewed from outside the face. Engrave cuts into the part; emboss raises the letters. Check the inspect record for engraving depth requirements.",
        "inputs": obj({
            "on": ref("face", "The flat face to put the text on"),
            "text": {"type": "string", "description": "The text, one line", "minLength": 1, "maxLength": 200},
            "font": enum(["Liberation Sans", "Liberation Sans Bold", "Liberation Serif", "Liberation Serif Bold",
                          "Liberation Mono", "Liberation Mono Bold"], "Font from the build image", default="Liberation Sans"),
            "height": num("Letter height", "mm", 0.5, 200),
            "mode": enum(["engrave", "emboss"], "Cut the letters in or raise them", default="engrave"),
            "depth": num("Engrave depth or emboss height", "mm", 0.05, 20),
            "at": AT,
            "align": enum(["left", "center", "right"], "Horizontal alignment about at", default="center"),
            "rotation": num("Rotation about the face normal", "deg", -360, 360, default=0),
        }, ["on", "text", "height", "depth"]),
        "creates": {"text_faces": "The faces of the letters"},
        "failures": failures("face_not_found", "ambiguous_reference", "not_planar", "too_large", "font_missing", "invalid_geometry"),
        "example": 'm.text("Deal text", on=m.face("Base", "front"), text="ACME", height=6, depth=0.5)',
    },
    {
        "id": "combine", "title": "Combine", "category": "Combine", "preview": "bodies",
        "summary": "Join, cut or intersect one part with another; cut and keep the tool to make an embed cavity.",
        "description": "Use to merge parts, to cut one part's shape out of another, or to keep only their overlap. Cutting with keep_tool makes the cavity an embedded object sits in, such as a coin in an acrylic block. The tool part is removed unless keep_tool is true.",
        "inputs": obj({
            "target": ref("part", "The part that is changed"),
            "tool": ref("part", "The part used to change it"),
            "operation": enum(["join", "cut", "intersect"], "Join adds the tool, cut removes it, intersect keeps only the overlap"),
            "keep_tool": {"type": "boolean", "description": "Keep the tool part afterwards", "default": False},
        }, ["target", "tool", "operation"]),
        "creates": {},
        "failures": failures("part_not_found", "missed_target", "invalid_geometry"),
        "example": 'm.combine("Coin cavity", target=m.part("Base"), tool=m.part("Coin"), operation="cut", keep_tool=True)',
    },
    {
        "id": "move", "title": "Move", "category": "Arrange", "preview": "bodies",
        "summary": "Translate or rotate a part, or align one of its faces to another face.",
        "description": "Use to place parts relative to each other, such as setting a figure on its base. Align moves the part so its face lies against the target face, facing it, at the offset. Moving changes no shapes.",
        "inputs": obj({
            "part": ref("part", "The part to move"),
            "method": enum(["translate", "rotate", "align"], "How to move it"),
            "by": vec3("Translation in model coordinates"),
            "axis": enum(["X", "Y", "Z"], "Axis to rotate about, through origin"),
            "angle": num("Rotation angle", "deg", -360, 360),
            "origin": vec3("A point on the rotation axis"),
            "face": ref("face", "The face of the moving part to align"),
            "to": ref(["face", "datum"], "The face or plane to align it to"),
            "offset": num("Gap left between the aligned faces", "mm", -2000, 2000, default=0),
        }, ["part", "method"], [
            when("method", "translate", ["by"]), when("method", "rotate", ["axis", "angle"]),
            when("method", "align", ["face", "to"]),
        ]),
        "creates": {},
        "failures": failures("part_not_found", "face_not_found", "ambiguous_reference", "datum_not_found", "not_planar"),
        "example": 'm.move("Lift coin", part=m.part("Coin"), method="translate", by=(0, 0, 2))',
    },
    {
        "id": "revolve", "title": "Revolve", "category": "Create", "preview": "bodies",
        "summary": "Spin a closed profile of radius and height points around a vertical axis to make a round part.",
        "description": "Use for round bodies: cup walls, bowls, foot rings, knobs and rolled lips. The profile is a list of (r, z) points from the axis outward, closed automatically and revolved about the vertical axis through at. Points may read PARAMS with mt.P. Not for straight prisms (use extrude) or shapes that change outline between heights (use loft).",
        "inputs": obj({
            "profile": {"type": "array", "description": "The outline as (r, z) points: distance from the axis and height", "minItems": 3, "maxItems": 200,
                        "items": {"type": "array", "description": "One (r, z) point", "minItems": 2, "maxItems": 2,
                                  "items": num("r, the distance from the axis, then z, the height", "mm", -2000, 2000)}},
            "smooth": {"type": "boolean", "description": "Draw a smooth curve through the points instead of straight lines", "default": False},
            "angle": num("How far to revolve; 360 makes a full ring", "deg", 1, 360, default=360),
            "at": vec3("A point on the vertical axis, in model coordinates; defaults to the origin"),
            "operation": enum(["new", "join", "cut"], "Make a new part named after the step, add to the target, or cut from it", default="new"),
            "target": ref("part", "The part to join to or cut from"),
        }, ["profile"], [when("operation", "join", ["target"]), when("operation", "cut", ["target"])]),
        "creates": {"surface": "The revolved faces"},
        "failures": failures("part_not_found", "missed_target", "invalid_geometry"),
        "example": 'm.revolve("Cup wall", profile=[(0, 0), (40, 0), (42, 95), (39, 95), (37, 3), (0, 3)])',
    },
    {
        "id": "loft", "title": "Loft", "category": "Create", "preview": "bodies",
        "summary": "Blend between horizontal outlines at increasing heights, such as a round base rising to an oval rim.",
        "description": "Use when the outline changes with height: a cup body that is round at the foot and oval at the rim, or a tapered plinth. Each section is a circle, ellipse, rectangle or rounded rectangle centred on the vertical axis through at, at height z. For one outline revolved round an axis use revolve; for a constant outline use extrude.",
        "inputs": obj({
            "sections": {"type": "array", "description": "The outlines from bottom to top, with strictly increasing z", "minItems": 2, "maxItems": 20,
                         "items": {"description": "One outline at one height", **obj({
                             "shape": enum(["circle", "ellipse", "rectangle", "rounded_rectangle"], "The outline at this height"),
                             "z": num("Height of the outline", "mm", -2000, 2000),
                             "diameter": num("Diameter of a circle", "mm", 0.1, 2000),
                             "width": num("Size along X of an ellipse or rectangle", "mm", 0.1, 2000),
                             "length": num("Size along Y of an ellipse or rectangle", "mm", 0.1, 2000),
                             "radius": num("Corner radius of a rounded rectangle", "mm", 0.05, 500),
                         }, ["shape", "z"], [
                             when("shape", "circle", ["diameter"]), when("shape", "ellipse", ["width", "length"]),
                             when("shape", "rectangle", ["width", "length"]),
                             when("shape", "rounded_rectangle", ["width", "length", "radius"]),
                         ])}},
            "ruled": {"type": "boolean", "description": "Join the outlines with straight sides instead of a smooth blend", "default": False},
            "at": vec3("A point on the vertical axis the outlines are centred on; defaults to the origin"),
            "operation": enum(["new", "join", "cut"], "Make a new part named after the step, add to the target, or cut from it", default="new"),
            "target": ref("part", "The part to join to or cut from"),
        }, ["sections"], [when("operation", "join", ["target"]), when("operation", "cut", ["target"])]),
        "creates": {"surface": "The blended side faces"},
        "failures": failures("part_not_found", "missed_target", "invalid_geometry"),
        "example": 'm.loft("Cup body", sections=[{"shape": "circle", "z": 0, "diameter": 62}, {"shape": "ellipse", "z": 95, "width": 86, "length": 72}])',
    },
    {
        "id": "sweep", "title": "Sweep", "category": "Create", "preview": "bodies",
        "summary": "Sweep a circle, ellipse or rectangle along a path of points, such as a cup handle.",
        "description": "Use for handles, rails, piping and wire-like shapes that follow a curve. The section is placed square to the path at its first point. By default the swept shape joins the target, which it must touch. Not for straight prisms (use extrude) or round bodies (use revolve).",
        "inputs": obj({
            "path": {"type": "array", "description": "Points the section travels through, in model coordinates", "minItems": 2, "maxItems": 200,
                     "items": vec3("A point on the path")},
            "section": enum(["circle", "ellipse", "rectangle"], "The cross-section", default="circle"),
            "diameter": num("Diameter of a circular section", "mm", 0.1, 500),
            "width": num("Width of an ellipse or rectangle section", "mm", 0.1, 500),
            "length": num("Length of an ellipse or rectangle section", "mm", 0.1, 500),
            "smooth": {"type": "boolean", "description": "Follow a smooth curve through the points instead of straight segments", "default": True},
            "operation": enum(["new", "join", "cut"], "Make a new part named after the step, add to the target, or cut from it", default="join"),
            "target": ref("part", "The part to join to or cut from"),
        }, ["path"], [
            when("section", "circle", ["diameter"]), when("section", "ellipse", ["width", "length"]),
            when("section", "rectangle", ["width", "length"]),
            when("operation", "join", ["target"]), when("operation", "cut", ["target"]),
        ]),
        "creates": {"surface": "The swept faces"},
        "failures": failures("part_not_found", "missed_target", "invalid_geometry"),
        "example": 'm.sweep("Handle", path=[(38, 0, 80), (60, 0, 72), (62, 0, 40), (38, 0, 25)], diameter=8, target=m.part("Cup wall"))',
    },
    {
        "id": "shell", "title": "Shell", "category": "Modify", "preview": "none",
        "summary": "Hollow out a part to a wall thickness, leaving the chosen faces open.",
        "description": "Use to turn a solid body into a vessel: a cup from a solid loft, a box with an open top. Open faces must belong to the target. With inward true the outside stays where it is. For a revolved cup, drawing the wall in the revolve profile is simpler and more robust.",
        "inputs": obj({
            "target": ref("part", "The part to hollow"),
            "thickness": num("Wall thickness", "mm", 0.2, 50),
            "open": {"type": "array", "description": "Faces of the target to leave open", "minItems": 0, "maxItems": 6,
                     "items": ref("face", "A face to remove")},
            "inward": {"type": "boolean", "description": "Keep the outside and grow the wall inward", "default": True},
        }, ["target", "thickness"]),
        "creates": {"inside": "The new inner faces"},
        "failures": failures("part_not_found", "face_not_found", "ambiguous_reference", "invalid_geometry"),
        "example": 'm.shell("Hollow", target=m.part("Cup body"), thickness=3, open=[m.face("Cup body", "top")])',
    },
    {
        "id": "custom", "title": "Custom step", "category": "Custom", "preview": "none",
        "summary": "Run a saved custom action, or a Python function from this script, for anything the other actions do not cover.",
        "description": "Give exactly one of action= (a saved action as id@version, listed by actions_list; its own inputs follow) or fn= (a top-level function in this script, defined outside the steps section as def name(m, **inputs), returning a dict of created names to faces). Every other keyword argument is passed on. Prefer a saved action; save a function you need twice with actions_save.",
        "inputs": obj({
            "fn": ref("fn", "A top-level function in this script to run, by name"),
            "action": {"type": "string", "description": "A saved action as id@version, for example finger-notch@2", "minLength": 3, "maxLength": 48},
        }, [], extra=True),
        "creates": {},
        "failures": failures("action_not_found", "action_rejected"),
        "example": 'm.custom("Notch", fn=notch, depth=2)',
    },
]

for action in actions:
    action["version"] = 1
    sel = []
    for name, prop in action["inputs"]["properties"].items():
        kinds = prop.get("x-ref") or (prop.get("items") or {}).get("x-ref")
        if not kinds or kinds == "fn":
            continue
        for kind in [kinds] if isinstance(kinds, str) else kinds:
            k = {"edges": "edge", "datum": "plane"}.get(kind, kind)
            count = prop.get("maxItems", 1)
            sel.append({"input": name, "kind": k, "min": 1 if name in action["inputs"]["required"] else 0, "max": count})
    action["selections"] = sel

ordered = [{k: a[k] for k in ["id", "version", "title", "category", "summary", "description", "inputs",
                               "selections", "creates", "failures", "preview", "example"]} for a in actions]
states = [
    {"state": "ok", "meaning": "The step ran and produced valid geometry."},
    {"state": "warning", "meaning": "The step ran, but something needs attention, such as a fillet radius that was reduced or text that runs past the face."},
    {"state": "failed", "meaning": "The step did not run; the model continues without it. The failure code says why and how to fix it."},
    {"state": "blocked", "meaning": "The step was not run because it refers to something a failed or suppressed step would have created."},
    {"state": "suppressed", "meaning": "The step is turned off. It stays in the script and can be turned back on."},
    {"state": "pending", "meaning": "The step is saved but has not been built yet."},
]
with open(sys.argv[1], "w") as f:
    json.dump({"version": 1, "states": states, "actions": ordered}, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(len(ordered), "actions")
