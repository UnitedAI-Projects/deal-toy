import { describe, expect, it } from "vitest";
import {
  ORIGIN_COLORS,
  originAxes,
  originHalfSize,
  originPickRef,
  originPlanes,
  originVisible,
} from "./origin";

describe("origin geometry", () => {
  it("is 60 mm across before the first build and grows with the model", () => {
    expect(originHalfSize(null)).toBe(60);
    expect(originHalfSize({ min: [0, 0, 0], max: [200, 10, 10] })).toBe(120);
    expect(originHalfSize({ min: [-5, -5, 0], max: [5, 5, 5] })).toBe(60);
  });
  it("draws each plane through the origin, spanning its two in-plane axes", () => {
    const planes = originPlanes(null);
    expect(planes.map((p) => p.name)).toEqual(["XY", "XZ", "YZ"]);
    const normal = { XY: 2, XZ: 1, YZ: 0 } as const;
    for (const plane of planes) {
      const n = normal[plane.name];
      for (const corner of plane.corners) expect(corner[n]).toBe(0);
      for (const k of [0, 1, 2].filter((k) => k !== n)) {
        const values = plane.corners.map((c) => c[k]);
        expect(Math.min(...values)).toBe(-60);
        expect(Math.max(...values)).toBe(60);
      }
    }
  });
  it("draws each axis from minus to plus half size along its own direction", () => {
    const axes = originAxes({ min: [0, 0, 0], max: [200, 10, 10] });
    expect(axes.map((a) => [a.name, a.from, a.to])).toEqual([
      ["X", [-120, 0, 0], [120, 0, 0]],
      ["Y", [0, -120, 0], [0, 120, 0]],
      ["Z", [0, 0, -120], [0, 0, 120]],
    ]);
  });
  it("colours planes by their normal axis and axes by themselves", () => {
    expect([ORIGIN_COLORS.XY, ORIGIN_COLORS.XZ, ORIGIN_COLORS.YZ]).toEqual([
      0x3b82f6, 0x22c55e, 0xef4444,
    ]);
    expect([ORIGIN_COLORS.X, ORIGIN_COLORS.Y, ORIGIN_COLORS.Z]).toEqual([
      0xef4444, 0x22c55e, 0x3b82f6,
    ]);
    expect(originPlanes(null).map((p) => p.color)).toEqual([
      0x3b82f6, 0x22c55e, 0xef4444,
    ]);
  });
});

describe("originVisible", () => {
  const ctx = { hasParts: false, pickingPlane: false, overrides: {} };
  it("shows on an empty model and hides once there are parts", () => {
    expect(originVisible("XY", ctx)).toBe(true);
    expect(originVisible("XY", { ...ctx, hasParts: true })).toBe(false);
  });
  it("shows again while a form is picking a plane", () => {
    expect(
      originVisible("XZ", { ...ctx, hasParts: true, pickingPlane: true }),
    ).toBe(true);
  });
  it("lets an override win", () => {
    expect(originVisible("X", { ...ctx, overrides: { X: false } })).toBe(false);
    expect(
      originVisible("YZ", { ...ctx, hasParts: true, overrides: { YZ: true } }),
    ).toBe(true);
  });
});

describe("originPickRef", () => {
  it("is the same reference the plane dropdown writes", () => {
    expect(originPickRef("XZ")).toEqual({ ref: "datum", name: "XZ" });
  });
});
