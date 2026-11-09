"""Fit fixture: a presentation box for a deal toy, with a hinged lid, a drawer and a plaque.

The lid turns on a hinge along the back top edge (revolute, LID_ANGLE), the drawer slides out of the
front (linear, DRAWER_OUT), and a plaque is fixed to the lid (rigid), so it moves with the lid.
Synthetic geometry for engine, Worker and viewer tests; not a customer design.
"""
import build123d as bd

PARAMS = {
    "LID_ANGLE": {"value": 0.0, "unit": "deg", "part": "Lid", "min": 0, "max": 110},
    "DRAWER_OUT": {"value": 0.0, "unit": "mm", "part": "Drawer", "min": 0, "max": 40},
}
BOTTOM = (bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)
LENGTH, DEPTH, HEIGHT, LID_T = 120.0, 80.0, 40.0, 6.0


def build():
    angle = PARAMS["LID_ANGLE"]["value"]
    out = PARAMS["DRAWER_OUT"]["value"]
    # Every boolean comes first: a boolean makes a new object, which would not carry the joints.
    base = bd.Box(LENGTH, DEPTH, HEIGHT, align=BOTTOM)
    base -= bd.Pos(0, -10, 5) * bd.Box(100, 62, 16, align=BOTTOM)  # the drawer opening
    base -= bd.Pos(0, 0, 25) * bd.Box(100, 60, 20, align=BOTTOM)  # the tray for the deal toy
    base.label = "Base"
    lid = bd.Pos(0, 0, HEIGHT) * bd.Box(LENGTH, DEPTH, LID_T, align=BOTTOM)
    lid.label = "Lid"
    drawer = bd.Pos(0, -11, 6) * bd.Box(98, 60, 14, align=BOTTOM)
    drawer.label = "Drawer"
    plaque = bd.Pos(0, -10, HEIGHT + LID_T) * bd.Box(60, 20, 2, align=BOTTOM)
    plaque.label = "Plaque"

    # The hinge turns about -X, so a positive angle lifts the lid's front edge.
    hinge = bd.RevoluteJoint("hinge", base, axis=bd.Axis((0, DEPTH / 2, HEIGHT), (-1, 0, 0)),
                             angular_range=(0, 110))
    pin = bd.RigidJoint("pin", lid, hinge.location)
    slide = bd.LinearJoint("slide", base, axis=bd.Axis((0, -DEPTH / 2, 6), (0, -1, 0)), linear_range=(0, 40))
    front = bd.RigidJoint("front", drawer, bd.Location((0, -DEPTH / 2, 6)))
    mount = bd.RigidJoint("plaque", lid, bd.Location((0, -10, HEIGHT + LID_T)))
    back = bd.RigidJoint("back", plaque, bd.Location((0, -10, HEIGHT + LID_T)))
    hinge.connect_to(pin, angle=angle)
    slide.connect_to(front, position=out)
    mount.connect_to(back)  # after the lid has moved, so the plaque rides on it
    return bd.Compound(children=[base, lid, drawer, plaque])


def dimensions(shape):
    base = shape.children[0]
    return [
        {"name": "Lid angle", "param": "LID_ANGLE", "joint": base.joints["hinge"]},
        {"name": "Drawer travel", "param": "DRAWER_OUT", "joint": base.joints["slide"]},
    ]
