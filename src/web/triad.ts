import { toScene } from "./inspect";
import { ORIGIN_AXES, type OriginAxis } from "./origin";

type Quat = [number, number, number, number];
type V3 = [number, number, number];

/** v rotated by the inverse of the unit quaternion q (x, y, z, w). */
function unrotate([x, y, z, w]: Quat, v: V3): V3 {
  const q: V3 = [-x, -y, -z];
  const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const t = cross(q, v).map((c) => 2 * c) as V3;
  const u = cross(q, t);
  return [0, 1, 2].map((k) => v[k] + w * t[k] + u[k]) as V3;
}

/**
 * Each model axis's direction on screen (x right, y up) for a camera with this orientation:
 * length 1 when the axis lies in the screen, near 0 when it points at the viewer.
 */
export function triadVectors(cameraQuaternion: Quat) {
  return Object.fromEntries(
    ORIGIN_AXES.map((name, k) => {
      const axis: V3 = [0, 0, 0];
      axis[k] = 1;
      const [x, y] = unrotate(cameraQuaternion, toScene(axis, 1));
      return [name, [x, y]];
    }),
  ) as Record<OriginAxis, [number, number]>;
}

/** How far each axis points toward the viewer, to draw the triad back to front. */
export function triadDepths(cameraQuaternion: Quat) {
  return Object.fromEntries(
    ORIGIN_AXES.map((name, k) => {
      const axis: V3 = [0, 0, 0];
      axis[k] = 1;
      return [name, unrotate(cameraQuaternion, toScene(axis, 1))[2]];
    }),
  ) as Record<OriginAxis, number>;
}
