"""Reference saved action: a rounded finger notch cut into a flat face.

Save it with the actions_save tool (id "finger-notch"); once its check build passes, any step can use
it as m.custom("Name", action="finger-notch@1", on=..., width=...).
"""
import build123d as bd
import mantel as mt


@mt.action(
    id="finger-notch",
    summary="Cut a rounded finger notch into a flat face so a lid or plaque can be lifted out.",
    inputs={
        "on": mt.Face("The flat face the notch opens onto; the notch is centred on it"),
        "width": mt.Length("Notch width across the face", min=4, max=40),
        "depth": mt.Length("How far the notch cuts in from the face", min=1, max=10, default=3),
    },
    creates={"notch": "The curved face of the notch"},
    example='m.custom("Base notch", action="finger-notch@1", on=m.face("Base", "back"), width=8)',
)
def finger_notch(m, on, width, depth):
    """Use on the edge of a lid, drawer front or display base where fingers need purchase.
    Not for round holes (use hole) or recesses with a straight outline (use extrude with cut)."""
    label, faces = m.resolve_faces(on)
    plane = mt.plane_of(faces)
    place = bd.Plane(origin=plane.origin, x_dir=plane.x_dir, z_dir=plane.z_dir)
    tool = place.location * bd.Cylinder(width / 2, depth * 2)
    m.parts[label] = m.parts[label] - tool
    notch = [f for f in m.parts[label].faces()
             if f.geom_type == bd.GeomType.CYLINDER and abs(f.radius - width / 2) < 1e-6]
    return {"notch": notch}
