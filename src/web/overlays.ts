import type { Ghost } from "./ghost";
import * as THREE from "three";
import {
  toScene,
  type FaceRecord,
  type InspectRecord,
  type Vec3,
} from "./inspect";

/**
 * Highlights drawn from the exact record, in the model's glTF frame (children of the loaded scene):
 * a filled quad for a flat face, a shell for a cylindrical face, and a box outline otherwise.
 */
export function faceOverlay(
  face: FaceRecord,
  scale: number,
  color: number,
): THREE.Object3D {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const { min, max } = face.bbox;
  if (face.plane) {
    const n = face.plane.normal;
    // The two axes the face spans, from its thin bounding box; exact for axis-aligned faces.
    const spans = [0, 1, 2]
      .sort((a, b) => Math.abs(n[a]) - Math.abs(n[b]))
      .slice(0, 2);
    const corner = (u: number, v: number): Vec3 => {
      const p: Vec3 = [...face.center] as Vec3;
      p[spans[0]] = u ? max[spans[0]] : min[spans[0]];
      p[spans[1]] = v ? max[spans[1]] : min[spans[1]];
      // Keep the corner on the face's plane.
      const off =
        (p[0] - face.plane!.origin[0]) * n[0] +
        (p[1] - face.plane!.origin[1]) * n[1] +
        (p[2] - face.plane!.origin[2]) * n[2];
      return [p[0] - off * n[0], p[1] - off * n[1], p[2] - off * n[2]];
    };
    const points = [
      corner(0, 0),
      corner(1, 0),
      corner(1, 1),
      corner(0, 1),
    ].flatMap((p) => toScene(p, scale));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    return new THREE.Mesh(geometry, material);
  }
  if (face.cylinder) {
    const { origin, axis, radius } = face.cylinder;
    const len = Math.hypot(...axis);
    const unit: Vec3 = [axis[0] / len, axis[1] / len, axis[2] / len];
    const ts = [0, 1].flatMap((i) =>
      [0, 1].flatMap((j) =>
        [0, 1].map((k) => {
          const p: Vec3 = [
            i ? max[0] : min[0],
            j ? max[1] : min[1],
            k ? max[2] : min[2],
          ];
          return (
            (p[0] - origin[0]) * unit[0] +
            (p[1] - origin[1]) * unit[1] +
            (p[2] - origin[2]) * unit[2]
          );
        }),
      ),
    );
    const low = Math.min(...ts);
    const high = Math.max(...ts);
    const geometry = new THREE.CylinderGeometry(
      radius * scale,
      radius * scale,
      (high - low) * scale,
      48,
      1,
      true,
    );
    const mesh = new THREE.Mesh(geometry, material);
    const mid: Vec3 = [0, 1, 2].map(
      (k) => origin[k] + unit[k] * ((low + high) / 2),
    ) as Vec3;
    mesh.position.fromArray(toScene(mid, scale));
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(...toScene(unit, 1)).normalize(),
    );
    return mesh;
  }
  const corners = [0, 1].flatMap((i) =>
    [0, 1].flatMap((j) =>
      [0, 1].map(
        (k) =>
          new THREE.Vector3(
            ...toScene(
              [i ? max[0] : min[0], j ? max[1] : min[1], k ? max[2] : min[2]],
              scale,
            ),
          ),
      ),
    ),
  );
  const box = new THREE.Box3().setFromPoints(corners);
  return new THREE.Box3Helper(box, color);
}

export function overlayGroup(
  record: InspectRecord,
  faces: number[],
  scale: number,
  color: number,
) {
  const group = new THREE.Group();
  group.name = "inspect-overlay";
  for (const index of faces) {
    const face = record.faces[index];
    if (face) group.add(faceOverlay(face, scale, color));
  }
  return group;
}

/**
 * The section plane in the loaded scene's frame. It removes the side nearer the default camera
 * (which looks from +X, -Y and +Z in model terms), so the cut faces the person: X and Z keep material
 * below the offset, Y keeps material behind it.
 */
export function sectionPlane(
  axis: "x" | "y" | "z",
  offset: number,
  scale: number,
): THREE.Plane {
  if (axis === "x")
    return new THREE.Plane(new THREE.Vector3(-1, 0, 0), offset * scale);
  if (axis === "y")
    return new THREE.Plane(new THREE.Vector3(0, 0, -1), -offset * scale);
  return new THREE.Plane(new THREE.Vector3(0, -1, 0), offset * scale);
}

/**
 * Stencil caps so a section shows filled cut faces, one shade per part so an embedded object reads
 * against its host: for each mesh, back faces count up and front faces count down where the plane
 * clips, and a plane drawn where the count is non-zero fills that mesh's cut.
 */
export function sectionCaps(
  object: THREE.Object3D,
  plane: THREE.Plane,
  colors: number[],
  size: number,
  partNodes: string[],
) {
  const group = new THREE.Group();
  group.name = "section-caps";
  // A part's meshes together form a closed volume (OCCT may write several meshes per part), so the
  // stencil count and the cap colour are per part.
  const byPart = new Map<string, THREE.Mesh[]>();
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.parent?.name === "inspect-overlay")
      return;
    let node: THREE.Object3D | null = o;
    while (node && !partNodes.includes(node.name)) node = node.parent;
    const key = node?.name ?? "";
    byPart.set(key, [...(byPart.get(key) ?? []), o]);
  });
  [...byPart.values()].forEach((meshes, k) => {
    const order = 10 + k * 3;
    const base = {
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      clippingPlanes: [plane],
    };
    for (const o of meshes) {
      o.updateWorldMatrix(true, false);
      for (const [side, op] of [
        [THREE.BackSide, THREE.IncrementWrapStencilOp],
        [THREE.FrontSide, THREE.DecrementWrapStencilOp],
      ] as const) {
        const m = new THREE.Mesh(
          o.geometry,
          new THREE.MeshBasicMaterial({
            ...base,
            side,
            stencilFail: op,
            stencilZFail: op,
            stencilZPass: op,
          }),
        );
        m.matrixAutoUpdate = false;
        m.matrix.copy(o.matrixWorld);
        m.renderOrder = order;
        group.add(m);
      }
    }
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 4, size * 4),
      new THREE.MeshStandardMaterial({
        color: colors[k % colors.length],
        metalness: 0,
        roughness: 0.8,
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp,
        stencilZFail: THREE.ReplaceStencilOp,
        stencilZPass: THREE.ReplaceStencilOp,
      }),
    );
    cap.name = "section-cap";
    cap.renderOrder = order + 1;
    plane.coplanarPoint(cap.position);
    cap.lookAt(cap.position.clone().sub(plane.normal));
    cap.onAfterRender = (renderer) => renderer.clearStencil();
    group.add(cap);
  });
  return group;
}

/** A translucent shape with outlined edges for an action being filled in. */
export function ghostObject(
  ghost: Ghost,
  scale: number,
  color: number,
): THREE.Object3D {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    // Seen through the model, so a hole or a cut inside a part is visible.
    depthTest: false,
  });
  const at = (p: Vec3) => new THREE.Vector3(...toScene(p, scale));
  const direction = (v: Vec3) =>
    new THREE.Vector3(...toScene(v, 1)).normalize();
  let geometry: THREE.BufferGeometry;
  const group = new THREE.Group();
  group.name = "ghost";
  const mesh = new THREE.Mesh(undefined, material);
  if (ghost.kind === "plane") {
    geometry = new THREE.PlaneGeometry(
      ghost.size * scale * 1.2,
      ghost.size * scale * 1.2,
    );
    mesh.position.copy(at(ghost.origin));
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      direction(ghost.normal),
    );
  } else if (ghost.kind === "cylinder") {
    geometry = new THREE.CylinderGeometry(
      ghost.radius * scale,
      ghost.radius * scale,
      ghost.length * scale,
      40,
    );
    const axis = direction(ghost.axis);
    mesh.position
      .copy(at(ghost.origin))
      .addScaledVector(axis, (ghost.length * scale) / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  } else if (ghost.kind === "prism") {
    geometry = new THREE.BoxGeometry(
      ghost.width * scale,
      ghost.length * scale,
      ghost.depth * scale,
    );
    const normal = direction(ghost.normal);
    mesh.position
      .copy(at(ghost.origin))
      .addScaledVector(normal, (ghost.depth * scale) / 2);
    // Width runs along model X where the face allows it, as the engine's sketch frame does.
    const x = new THREE.Vector3(1, 0, 0);
    if (Math.abs(x.dot(normal)) > 0.99) x.set(0, 0, -1);
    const y = new THREE.Vector3().crossVectors(normal, x).normalize();
    x.crossVectors(y, normal).normalize();
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(x, y, normal),
    );
  } else {
    const box = new THREE.Box3().setFromPoints([at(ghost.min), at(ghost.max)]);
    geometry = new THREE.BoxGeometry(
      ...box.getSize(new THREE.Vector3()).toArray(),
    );
    box.getCenter(mesh.position);
  }
  mesh.geometry = geometry;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineDashedMaterial({
      color,
      dashSize: 2 * scale,
      gapSize: 1.5 * scale,
    }),
  );
  edges.computeLineDistances();
  edges.position.copy(mesh.position);
  edges.quaternion.copy(mesh.quaternion);
  mesh.renderOrder = 50;
  edges.renderOrder = 51;
  group.add(mesh, edges);
  return group;
}
