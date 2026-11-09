import { describe, expect, it } from "vitest";
import fitJson from "../../engine/tests/fixtures/display_box_fit.inspect.json";
import posedJson from "../../engine/tests/fixtures/display_box_fit_posed.inspect.json";
import boxJson from "../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import type { InspectRecord, JointRecord, Vec3 } from "../shared/inspect-types";
import {
  angleAround,
  applyDirection,
  applyPoint,
  explodeOffsets,
  invertRigid,
  jointDragValue,
  jointFrames,
  jointMotion,
  partTransforms,
} from "./fit";
import { pickFace } from "./inspect";

const fit = fitJson as unknown as InspectRecord;
const posed = posedJson as unknown as InspectRecord;
const box = boxJson as unknown as InspectRecord;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const label = (record: InspectRecord, name: string) =>
  record.parts.findIndex((p) => p.label === name);
const jointOf = (record: InspectRecord, name: string) =>
  record.joints!.findIndex((j) => j.name === name);
const close = (a: Vec3, b: Vec3, digits = 4) =>
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k], digits));
const gap = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("partTransforms", () => {
  it("moves each part where build123d puts it for the same joint values", () => {
    const poses = { [jointOf(fit, "hinge")]: 60, [jointOf(fit, "slide")]: 25 };
    const matrices = partTransforms(fit, 0, poses);
    for (const part of fit.parts) {
      const expected = posed.parts.find((p) => p.label === part.label)!;
      close(
        applyPoint(matrices[part.index], part.center_of_mass),
        expected.center_of_mass,
      );
    }
  });
  it("is the identity when collapsed and not posed", () => {
    for (const m of partTransforms(fit, 0, {})) expect(m).toEqual(IDENTITY);
  });
  it("explodes jointed parts along their joints, children with their parents", () => {
    const moved = partTransforms(fit, 1, {});
    const com = (name: string) => fit.parts[label(fit, name)].center_of_mass;
    const at = (name: string) => applyPoint(moved[label(fit, name)], com(name));
    expect(at("Base")).toEqual(com("Base"));
    const drawer = at("Drawer");
    expect(drawer[0]).toBeCloseTo(com("Drawer")[0], 9);
    expect(drawer[1]).toBeLessThan(com("Drawer")[1] - 1);
    expect(gap(at("Plaque"), com("Plaque"))).toBeGreaterThanOrEqual(
      gap(at("Lid"), com("Lid")) - 1e-9,
    );
  });
  it("explodes a model without joints radially", () => {
    const moved = partTransforms(box, 1, {});
    const coms = box.parts.map((p) =>
      applyPoint(moved[p.index], p.center_of_mass),
    );
    for (const a of box.parts)
      for (const b of box.parts)
        if (a.index < b.index)
          expect(gap(coms[a.index], coms[b.index])).toBeGreaterThan(
            gap(a.center_of_mass, b.center_of_mass),
          );
  });
  it("clamps the explode amount", () => {
    expect(explodeOffsets(fit, 5)).toEqual(explodeOffsets(fit, 1));
    expect(explodeOffsets(fit, -1).every((v) => v.every((x) => x === 0))).toBe(
      true,
    );
  });
});

describe("picking on moved parts", () => {
  it("maps a hit back to the record's frame, picking the same face", () => {
    const drawer = label(fit, "Drawer");
    const m = partTransforms(fit, 0.5, { [jointOf(fit, "slide")]: 25 })[drawer];
    for (const face of fit.faces.filter((f) => f.part === drawer)) {
      const hit = applyPoint(m, face.center);
      const back = applyPoint(invertRigid(m), hit);
      close(back, face.center, 9);
      expect(pickFace(fit, "Drawer", back)).toBe(
        pickFace(fit, "Drawer", face.center),
      );
    }
  });
  it("inverts a rotation", () => {
    const lid = fit.joints![jointOf(fit, "hinge")];
    const m = jointMotion(lid, 75);
    const p: Vec3 = [12, -30, 44];
    close(applyPoint(invertRigid(m), applyPoint(m, p)), p, 9);
  });
});

describe("jointMotion", () => {
  const linear: JointRecord = {
    name: "rail",
    kind: "linear",
    part: 1,
    to: 0,
    origin: [0, 0, 0],
    axis: [0, 0, 2],
    range: [0, 10],
    value: 2,
    unit: "mm",
  };
  it("slides along the unit axis by the change in value", () => {
    close(applyPoint(jointMotion(linear, 5), [1, 1, 1]), [1, 1, 4], 9);
  });
  it("turns right-handed about the axis line", () => {
    const hinge = {
      ...linear,
      kind: "revolute" as const,
      origin: [0, 10, 0] as Vec3,
      axis: [0, 0, 1] as Vec3,
      value: 0,
      unit: "deg" as const,
    };
    close(applyPoint(jointMotion(hinge, 90), [5, 10, 3]), [0, 15, 3], 9);
  });
  it("never moves a rigid joint", () => {
    expect(jointMotion({ ...linear, kind: "rigid" }, 7)).toEqual(IDENTITY);
  });
});

describe("angleAround", () => {
  const o: Vec3 = [0, 0, 0];
  const z: Vec3 = [0, 0, 1];
  const x: Vec3 = [1, 0, 0];
  it("measures the signed angle where the ray meets the plane", () => {
    expect(angleAround([0, 5, 10], [0, 0, -1], o, z, x)).toBeCloseTo(90, 9);
    expect(angleAround([0, -5, 10], [0, 0, -1], o, z, x)).toBeCloseTo(-90, 9);
    expect(angleAround([5, 0, -3], [0, 0, 1], o, z, x)).toBeCloseTo(0, 9);
  });
  it("gives null for a ray in the plane, or a hit on the axis", () => {
    expect(angleAround([0, 5, 0], [1, 0, 0], o, z, x)).toBeNull();
    expect(angleAround([0, 0, 10], [0, 0, -1], o, z, x)).toBeNull();
  });
});

describe("jointDragValue", () => {
  const hinge = fit.joints![jointOf(fit, "hinge")];
  const slide = fit.joints![jointOf(fit, "slide")];
  it("snaps to 1° or 0.1 mm and clamps to both ranges", () => {
    expect(jointDragValue(hinge, undefined, 0, 130)).toBe(110);
    expect(jointDragValue(hinge, undefined, 0, 42.4)).toBe(42);
    expect(jointDragValue(slide, undefined, 0, 41)).toBe(40);
    expect(jointDragValue(slide, undefined, 0, 12.34)).toBe(12.3);
    expect(jointDragValue(slide, { value: 0, min: 0, max: 30 }, 0, 35)).toBe(
      30,
    );
    expect(
      jointDragValue(slide, { value: 0, min: 0, max: 10, scale: 2 }, 0, 35),
    ).toBe(20);
    expect(jointDragValue(slide, undefined, 5, -9)).toBe(0);
  });
  it("holds the start value when the pointer gives no number", () => {
    expect(jointDragValue(slide, undefined, 7, Number.NaN)).toBe(7);
  });
});

describe("jointFrames", () => {
  it("carries each joint's axis with the part it is fixed to", () => {
    const hinge = jointOf(fit, "hinge");
    const plaque = jointOf(fit, "plaque");
    const poses = { [hinge]: 60 };
    const frames = jointFrames(fit, 0, poses);
    const lid = partTransforms(fit, 0, poses)[label(fit, "Lid")];
    expect(frames[plaque]).toEqual(lid);
    expect(frames[hinge]).toEqual(IDENTITY);
    const exploded = jointFrames(fit, 1, {});
    const offset = explodeOffsets(fit, 1)[label(fit, "Drawer")];
    close(applyPoint(exploded[jointOf(fit, "slide")], [0, 0, 0]), offset, 9);
    close(
      applyDirection(lid, [0, 0, 1]),
      applyPoint(lid, [0, 0, 1]).map(
        (v, k) => v - applyPoint(lid, [0, 0, 0])[k],
      ) as Vec3,
      9,
    );
  });
});
