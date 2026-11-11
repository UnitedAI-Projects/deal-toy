"""The SpaceX IPO deal toy as MantelCAD command scripts, one per revision of the demo.

    python3 examples/spacex-ipo/toy.py OUT_DIR

writes r1.json ... r5.json: each revision's full command script (MantelCAD replays it from an
empty design). The demo's story: the agent starts the model (r1), adds the hardware (r2), the
designer raises the base by hand (r3), the agent adds the lettering and plaques (r4), and the
designer widens the pad after the stability check (r5).
"""
import json
import sys
from pathlib import Path

C = list  # a command list


def cmd(command, **params):
    return {"command": command, "params": params}


def z(offset):
    """A height above the base's top face, following base_height."""
    return f"base_height + {offset} mm"


def params(base_height=28, pad_diameter=96):
    return [
        cmd("parameters.add", name="base_height", expression=f"{base_height} mm"),
        cmd("parameters.add", name="pad_diameter", expression=f"{pad_diameter} mm"),
        cmd("parameters.add", name="body_diameter", expression="16 mm"),
    ]


def base():
    return [
        cmd("sketch.create", plane="XY", name="Base profile"),
        cmd("sketch.polygon.inscribed", center=[0, 0], radius=66, sides=6, angle=0),
        cmd("sketch.finish"),
        cmd("solid.extrude", distance="base_height", body_name="Base"),
        cmd("solid.cylinder", diameter="pad_diameter", height="4 mm", base=[0, 0, "base_height"],
            body_name="Landing pad"),
        # The landing mark: a ring and a cross, just proud of the pad.
        cmd("solid.cylinder", diameter="pad_diameter - 10 mm", height="0.6 mm", base=[0, 0, z(4)],
            body_name="Pad ring"),
        cmd("solid.cylinder", diameter="pad_diameter - 13 mm", height="0.6 mm", base=[0, 0, z(4)],
            operation="cut", targets=["Pad ring"]),
        cmd("solid.box", length="pad_diameter - 24 mm", width="2.4 mm", height="0.6 mm",
            center=[0, 0, z(4.3)], body_name="Pad cross"),
        cmd("solid.box", length="2.4 mm", width="pad_diameter - 24 mm", height="0.6 mm",
            center=[0, 0, z(4.3)], operation="join", targets=["Pad cross"]),
    ]


def rocket():
    return [
        cmd("solid.cylinder", diameter="body_diameter", height="16 mm", base=[0, 0, z(16)],
            body_name="Engine section"),
        cmd("solid.cylinder", diameter="body_diameter", height="170 mm", base=[0, 0, z(32)],
            body_name="First stage"),
        cmd("solid.cylinder", diameter="body_diameter + 0.4 mm", height="12 mm", base=[0, 0, z(202)],
            body_name="Interstage"),
        cmd("solid.cylinder", diameter="body_diameter", height="58 mm", base=[0, 0, z(214)],
            body_name="Second stage"),
        cmd("solid.cylinder", diameter="19 mm", height="30 mm", base=[0, 0, z(272)], body_name="Fairing"),
        # The fairing's tangent ogive nose, revolved about the rocket's axis (YZ: sketch y is world Z).
        cmd("sketch.create", plane="YZ", name="Nose profile"),
        cmd("sketch.line", points=[[0, z(302)], [9.5, z(302)]], ids=["n1"]),
        cmd("sketch.arc.three_point", start=[9.5, z(302)], end=[0, z(339)], through=[7.24, z(320.5)]),
        cmd("sketch.line", points=[[0, z(339)], [0, z(302)]]),
        cmd("sketch.finish"),
        cmd("solid.revolve", axis="y", operation="join", targets=["Fairing"]),
        cmd("solid.cylinder", diameter="19.3 mm", height="0.5 mm", base=[0, 0, z(290)],
            body_name="Fairing seam"),
    ]


def legs():
    """Legs built from cylinders tilted with solid.move, then patterned four times about Z."""
    out = []
    import math
    r = 7.6
    foot = (38.0, 0.0)  # x, height above the pad's top face at 4 mm
    for top, name in ((40.0, "Leg strut"), (24.0, "Leg brace")):
        dx, dz = foot[0] - r, top
        length = math.hypot(dx, dz)
        tilt = math.degrees(math.atan2(dx, dz))
        out += [
            # Made upright at the origin, leaned inward about Y, then carried out to its foot.
            cmd("solid.cylinder", diameter="1.6 mm", height=f"{length:.3f} mm", base=[0, 0, 0],
                body_name=name),
            cmd("solid.move", bodies=[name], axis=[0, 1, 0], angle=f"{-tilt:.3f} deg"),
            cmd("solid.move", bodies=[name], translate=[foot[0], 0, z(4)]),
        ]
    out += [
        cmd("solid.cylinder", diameter="4 mm", height="1.2 mm", base=[foot[0], 0, z(4)], body_name="Foot"),
        cmd("solid.pattern.circular", bodies=["Leg strut", "Leg brace", "Foot"], axis="Z", count=4),
        # Grid fins at the interstage.
        cmd("solid.box", length="5 mm", width="0.8 mm", height="5 mm", center=[r + 2.6, 0, z(208)],
            body_name="Grid fin"),
        cmd("solid.pattern.circular", bodies=["Grid fin"], axis="Z", count=4),
    ]
    return out


def engines():
    return [
        cmd("solid.cone", radius="2.2 mm", top_radius="1.3 mm", height="6 mm", base=[0, 0, z(10)],
            body_name="Engine 1"),
        cmd("solid.cone", radius="2.2 mm", top_radius="1.3 mm", height="6 mm", base=[5.2, 0, z(10)],
            body_name="Engine 2"),
        cmd("solid.pattern.circular", bodies=["Engine 2"], axis="Z", count=8),
    ]


APOTHEM = 66 * 0.8660254  # the hex base's centre-to-flat distance, mm
# How many separate letter bodies each text extrudes into with MantelCAD's built-in font.
PIECES = {"Lettering SPACEX": 6, "Lettering ticker": 12, "Lettering IPO": 7,
          "Plaque text front": 42, "Plaque text listing": 20, "Plaque text occasion": 11}


def joined(name):
    """Joins the letters an extrude made (name, name (2), ...) into one body."""
    return cmd("solid.combine", target=name, tools=[f"{name} ({k})" for k in range(2, PIECES[name] + 1)],
               operation="join", touching="one_body")


def wrapped_text(text, z_center, radius, height, name):
    """Lettering 0.3 mm proud of a cylinder of `radius`, reading bottom to top on the front (-Y).

    Flat letters set into the cylinder, so they read as applied lettering at the centre line: far
    lighter geometry than letters wrapped onto the curve, which a STEP export carries as splines.
    """
    return [
        # The plane touches the cylinder's front line; the letters go 1.2 mm into it.
        cmd("sketch.create", plane="XZ", offset=f"{-(radius + 0.3):.3f} mm", flip=True, name=f"{name} sketch"),
        cmd("sketch.text", text=text, at=[-height / 2, z(z_center)], height=height, angle=90,
            align="center", letter_spacing=height * 0.18),
        cmd("sketch.finish"),
        cmd("solid.extrude", distance="-1.2 mm", body_name=name),
        joined(name),
    ]


def lettering():
    return (wrapped_text("SPACEX", 118, 8, 6.5, "Lettering SPACEX")
            + wrapped_text("NASDAQ: SPCX", 243, 8, 2.6, "Lettering ticker")
            + wrapped_text("IPO 2026", 286, 9.5, 2.6, "Lettering IPO"))


def plaque_lines(lines, name, turn):
    """Raised black lettering on a plaque; made on the front flat, then turned to its flat."""
    face = APOTHEM + 1.2
    out = [cmd("sketch.create", plane="XZ", offset=f"{-face:.3f} mm", flip=True, name=f"{name} sketch")]
    for text, height, rise in lines:
        out.append(cmd("sketch.text", text=text, at=[0, f"base_height / 2 + {rise} mm"], height=height,
                       align="center"))
    out += [cmd("sketch.finish"), cmd("solid.extrude", distance="0.4 mm", body_name=name), joined(name)]
    if turn:
        out.append(cmd("solid.move", bodies=[name], axis=[0, 0, 1], angle=f"{turn} deg"))
    return out


def plaques():
    out = [
        cmd("solid.box", length="58 mm", width="1.2 mm", height="base_height - 8 mm",
            center=[0, f"{-(APOTHEM + 0.6):.3f} mm", "base_height / 2"], body_name="Plaque front"),
        cmd("solid.move", bodies=["Plaque front"], axis=[0, 0, 1], angle="60 deg", copy=True),
        cmd("solid.move", bodies=["Plaque front"], axis=[0, 0, 1], angle="-60 deg", copy=True),
    ]
    out += plaque_lines([("SPACEX", 5, 2.2), ("INITIAL PUBLIC OFFERING", 1.6, -1.2),
                         ("$75,000,000,000", 2.8, -5.6)], "Plaque text front", 0)
    out += plaque_lines([("NASDAQ", 1.8, 3.6), ("SPCX", 4.5, -1.2), ("JUNE 12, 2026", 1.6, -5)],
                        "Plaque text listing", 60)
    out += plaque_lines([("IPO", 4.5, 0.6), ("JUNE 2026", 1.6, -4)], "Plaque text occasion", -60)
    return out


# Every body the full model has, for colouring (patterns and copies number theirs from 2).
BODIES = (["Base", "Landing pad", "Pad ring", "Pad cross", "Engine section", "First stage", "Interstage",
           "Second stage", "Fairing", "Fairing seam", "Engine 1", "Engine 2"]
          + [f"Engine 2 ({k})" for k in range(2, 9)]
          + [f"{n}{s}" for n in ("Leg strut", "Leg brace", "Foot", "Grid fin") for s in ("", " (2)", " (3)", " (4)")]
          + ["Lettering SPACEX", "Lettering ticker", "Lettering IPO", "Plaque front", "Plaque front (2)",
             "Plaque front (3)", "Plaque text front", "Plaque text listing", "Plaque text occasion"])
WHITE, BLACK = "#f2f2ef", "#161616"
SILVER = {"color": "#c5c8cc", "pbr": {"metallic": 1, "roughness": 0.32, "dielectric_ior": 1.5}}
DARK_METAL = {"color": "#3b3e43", "pbr": {"metallic": 1, "roughness": 0.4, "dielectric_ior": 1.5}}


def looks(bodies):
    """Colours by body name: white rocket, black bands and base, silver plaques and legs."""
    def look(names, color, **extra):
        present = [b for b in names if b in bodies]
        return [cmd("appearance.assign", bodies=present, color=color, **extra)] if present else []

    out = []
    out += look(["First stage", "Second stage", "Fairing"], WHITE,
                pbr={"metallic": 0, "roughness": 0.18, "dielectric_ior": 1.5})
    out += look(["Base", "Engine section", "Interstage", "Fairing seam"]
                + [b for b in bodies if b.startswith(("Grid fin", "Lettering", "Plaque text"))], BLACK,
                pbr={"metallic": 0, "roughness": 0.25, "dielectric_ior": 1.5})
    out += look(["Landing pad"], DARK_METAL["color"], pbr=DARK_METAL["pbr"])
    out += look(["Pad ring", "Pad cross"] + [b for b in bodies if b.startswith(("Leg", "Foot", "Plaque front"))],
                SILVER["color"], pbr=SILVER["pbr"])
    out += look([b for b in bodies if b.startswith("Engine ") and b != "Engine section"], DARK_METAL["color"],
                pbr=DARK_METAL["pbr"])
    return out


def revisions():
    """Each revision's full script, replayed from an empty design."""
    start = base() + rocket()
    hardware = engines() + legs()
    finish = lettering() + plaques()
    first = BODIES[:10]  # the base, pad and rocket bodies
    with_hardware = [b for b in BODIES if not b.startswith(("Lettering", "Plaque"))]
    r1 = params() + start
    r2 = r1 + hardware
    r3 = params(base_height=32) + start + hardware
    r4 = r3 + finish
    r5 = params(base_height=32, pad_diameter=104) + start + hardware + finish
    return {"r1": r1 + looks(first), "r2": r2 + looks(with_hardware), "r3": r3 + looks(with_hardware),
            "r4": r4 + looks(BODIES), "r5": r5 + looks(BODIES)}


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name, commands in revisions().items():
        (out / f"{name}.script.json").write_text(json.dumps({"commands": commands}, indent=1))
