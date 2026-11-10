import type { Vec3 } from "../shared/inspect-types";

/** The model's built-in origin planes and axes, in the model frame (mm, Z up). */
export type OriginPlane = "XY" | "XZ" | "YZ";
export type OriginAxis = "X" | "Y" | "Z";
export type OriginItem = OriginPlane | OriginAxis;
export const ORIGIN_PLANES: OriginPlane[] = ["XY", "XZ", "YZ"];
export const ORIGIN_AXES: OriginAxis[] = ["X", "Y", "Z"];
export const ORIGIN_ITEMS: OriginItem[] = [...ORIGIN_PLANES, ...ORIGIN_AXES];

const RED = 0xef4444;
const GREEN = 0x22c55e;
const BLUE = 0x3b82f6;
/** Planes take the colour of their normal axis. */
export const ORIGIN_COLORS: Record<OriginItem, number> = {
  XY: BLUE,
  XZ: GREEN,
  YZ: RED,
  X: RED,
  Y: GREEN,
  Z: BLUE,
};

type Bounds = { min: Vec3; max: Vec3 } | null;

/** Half the drawn size: 60 mm, or larger so the planes reach past the model. */
export function originHalfSize(bounds: Bounds): number {
  if (!bounds) return 60;
  const reach = Math.max(...[...bounds.min, ...bounds.max].map(Math.abs));
  return Math.max(60, 0.6 * reach);
}

/** Which model coordinates each plane spans: [first in-plane axis, second, normal]. */
const SPAN: Record<OriginPlane, [number, number, number]> = {
  XY: [0, 1, 2],
  XZ: [0, 2, 1],
  YZ: [1, 2, 0],
};

export function originPlanes(bounds: Bounds) {
  const h = originHalfSize(bounds);
  return ORIGIN_PLANES.map((name) => {
    const [u, v] = SPAN[name];
    const corner = (a: number, b: number): Vec3 => {
      const p: Vec3 = [0, 0, 0];
      p[u] = a;
      p[v] = b;
      return p;
    };
    return {
      name,
      corners: [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)] as [
        Vec3,
        Vec3,
        Vec3,
        Vec3,
      ],
      color: ORIGIN_COLORS[name],
    };
  });
}

export function originAxes(bounds: Bounds) {
  const h = originHalfSize(bounds);
  return ORIGIN_AXES.map((name, k) => {
    const from: Vec3 = [0, 0, 0];
    const to: Vec3 = [0, 0, 0];
    from[k] = -h;
    to[k] = h;
    return { name, from, to, color: ORIGIN_COLORS[name] };
  });
}

/** An override wins; otherwise the origin shows on an empty model or while picking a plane. */
export function originVisible(
  item: OriginItem,
  ctx: {
    hasParts: boolean;
    pickingPlane: boolean;
    overrides: Partial<Record<OriginItem, boolean>>;
  },
): boolean {
  return ctx.overrides[item] ?? (!ctx.hasParts || ctx.pickingPlane);
}

/** The reference a plane pick writes, the same one the plane dropdown writes. */
export function originPickRef(name: OriginPlane) {
  return { ref: "datum" as const, name };
}
