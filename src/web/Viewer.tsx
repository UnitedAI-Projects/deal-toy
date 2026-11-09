import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { request } from "./api";
import { alongAxis } from "./adjust";
import {
  angleAround,
  applyDirection,
  applyPoint,
  invertRigid,
  type Mat4,
} from "./fit";
import {
  sceneScale,
  toModel,
  toScene,
  type InspectRecord,
  type Vec3,
} from "./inspect";
import type { Ghost } from "./ghost";
import {
  ghostObject,
  overlayGroup,
  sectionCaps,
  sectionPlane,
} from "./overlays";
const palette = {
  light: { grid: 0xd9d9d4, gridMajor: 0xc7c7c1, highlight: 0x6366f1 },
  dark: { grid: 0x2a2c31, gridMajor: 0x3a3d44, highlight: 0x818cf8 },
};
type Props = {
  artifactId?: string;
  /** Changing this re-fits the camera; revisions of one model keep the current view. */
  modelKey: string;
  theme: "light" | "dark";
  parts: string[];
  selected: string | null;
  /** hit is the clicked point in model coordinates (mm), when the inspection record is loaded. */
  onSelect: (
    label: string | null,
    point: { x: number; y: number },
    hit?: Vec3,
    additive?: boolean,
  ) => void;
  /** The build's exact record; enables face picking, face highlights and sections. */
  record?: InspectRecord | null;
  /** Faces to draw over the model: the person's picks and the agent's highlights. */
  highlights?: {
    faces: number[];
    tone: "pick" | "agent" | "fail" | "warn";
  }[];
  /** Cut the model where the model coordinate on `axis` exceeds `offset` (mm). */
  section?: { axis: "x" | "y" | "z"; offset: number } | null;
  /** An approximate preview of an action being filled in. */
  ghost?: Ghost | null;
  /**
   * A drag handle on a declared dimension's face (model frame). Dragging reports how far the
   * pointer has moved along the face normal, in mm; release commits and Escape cancels.
   */
  handle?: {
    key: string;
    origin: Vec3;
    direction: Vec3;
    onMove: (along: number) => void;
    onRelease: () => void;
    onCancel: () => void;
  } | null;
  /**
   * Where each part is shown, as model-frame matrices indexed like the record's parts (from
   * fit.ts). Null shows the build as it is. `key` changes whenever the matrices do.
   */
  pose?: { key: string; matrices: Mat4[] } | null;
  /**
   * Dragging a part along its joint. `joints` lists the record joints that may be dragged, and
   * `frames` where each record joint's frame is now. Deltas are mm for a linear joint and degrees
   * for a revolute one; release commits and Escape cancels.
   */
  move?: {
    joints: number[];
    frames: Mat4[];
    onStart: (joint: number) => void;
    onMove: (delta: number) => void;
    onRelease: () => void;
    onCancel: () => void;
  } | null;
};
type Scene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  object: THREE.Object3D | null;
  fittedFor: string;
  /** The loaded mesh's size in its own frame, to relate it to the record's millimetres. */
  size: THREE.Vector3;
  renderer: THREE.WebGLRenderer;
  caps: THREE.Object3D | null;
  /** Each labelled part node's local matrix as loaded, so a pose can always be undone exactly. */
  rest: Map<THREE.Object3D, THREE.Matrix4>;
};
export function Viewer(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<Scene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        stencil: true,
      });
    } catch {
      setError("3D preview requires WebGL. You can still download the model.");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    element.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    camera.position.set(160, 110, 180);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(90, 160, 120);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(-120, 60, -100);
    scene.add(rim);
    const colors = palette[latest.current.theme];
    const grid = new THREE.GridHelper(400, 40, colors.gridMajor, colors.grid);
    scene.add(grid);
    state.current = {
      scene,
      camera,
      controls,
      grid,
      object: null,
      fittedFor: "",
      size: new THREE.Vector3(1, 1, 1),
      renderer,
      caps: null,
      rest: new Map(),
    };
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    // A click (not a drag) selects the labelled part under the pointer.
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5)
        return;
      const s = state.current;
      if (!s?.object) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, s.camera);
      const hit = ray.intersectObject(s.object, true)[0];
      const labels = new Map(latest.current.parts.map((p) => [nodeName(p), p]));
      let node: THREE.Object3D | null = hit?.object ?? null;
      while (node && !labels.has(node.name)) node = node.parent;
      const record = latest.current.record;
      let model: Vec3 | undefined;
      if (hit && record) {
        const local = s.object.worldToLocal(hit.point.clone());
        const size = s.size;
        model = toModel(
          [local.x, local.y, local.z],
          sceneScale(record, [size.x, size.z, size.y]),
        );
        // A moved part's hit maps back to where the record measured that part.
        const index = node
          ? record.parts.findIndex((p) => nodeName(p.label) === node!.name)
          : -1;
        const m = latest.current.pose?.matrices[index];
        if (m) model = applyPoint(invertRigid(m), model);
      }
      latest.current.onSelect(
        node ? (labels.get(node.name) ?? null) : null,
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        model,
        e.shiftKey,
      );
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      scene.traverse(disposeMesh);
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const colors = palette[props.theme];
    s.scene.remove(s.grid);
    s.grid.dispose();
    s.grid = new THREE.GridHelper(400, 40, colors.gridMajor, colors.grid);
    s.scene.add(s.grid);
    highlight(s.object, props.selected, colors.highlight);
  }, [props.theme]);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (!props.artifactId) {
      if (s.object) {
        s.scene.remove(s.object);
        s.object.traverse(disposeMesh);
        s.object = null;
      }
      return;
    }
    let cancelled = false;
    setError("");
    setLoading(true);
    void request(`/api/artifacts/${props.artifactId}`)
      .then((r) => r.arrayBuffer())
      .then((data) => new GLTFLoader().parseAsync(data, ""))
      .then((gltf) => {
        if (cancelled || !state.current) {
          gltf.scene.traverse(disposeMesh);
          return;
        }
        const object = gltf.scene;
        // Each mesh gets its own material so a selection highlight affects only its part. The
        // export has no materials, and glTF's default is fully metallic, which renders faces turned
        // away from the lights (an opened lid's underside) black; half as metallic, every face reads.
        const matte = (m: THREE.Material) => {
          const copy = m.clone();
          if (copy instanceof THREE.MeshStandardMaterial) copy.metalness = 0.5;
          return copy;
        };
        object.traverse((o) => {
          if (o instanceof THREE.Mesh)
            o.material = Array.isArray(o.material)
              ? o.material.map(matte)
              : matte(o.material);
        });
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        object.position.sub(center);
        object.position.y += size.y / 2;
        if (s.object) {
          s.scene.remove(s.object);
          s.object.traverse(disposeMesh);
        }
        s.scene.add(object);
        s.object = object;
        s.size = size.clone();
        s.rest = new Map();
        object.updateWorldMatrix(true, true);
        for (const label of latest.current.parts) {
          const node = object.getObjectByName(nodeName(label));
          if (node) s.rest.set(node, node.matrix.clone());
        }
        setLoaded((n) => n + 1);
        if (s.fittedFor !== latest.current.modelKey) {
          // Portrait screens need more distance to fit the model's width.
          const radius = size.length() / Math.min(1, s.camera.aspect);
          const target = new THREE.Vector3(0, size.y / 2, 0);
          s.controls.target.copy(target);
          s.camera.position
            .copy(target)
            .add(new THREE.Vector3(radius * 0.95, radius * 0.6, radius * 1.05));
          s.camera.near = Math.max(0.01, radius / 1000);
          s.camera.far = radius * 100;
          s.camera.updateProjectionMatrix();
          s.fittedFor = latest.current.modelKey;
        }
        highlight(
          object,
          latest.current.selected,
          palette[latest.current.theme].highlight,
        );
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.artifactId]);

  useEffect(() => {
    highlight(
      state.current?.object ?? null,
      props.selected,
      palette[props.theme].highlight,
    );
  }, [props.selected]);

  // Face highlights, drawn from the exact record in the model's own frame.
  useEffect(() => {
    const s = state.current;
    const object = s?.object;
    if (!s || !object) return;
    object.getObjectByName("inspect-overlay")?.removeFromParent();
    const record = props.record;
    if (!record || !props.highlights?.length) return;
    const scale = sceneScale(record, [s.size.x, s.size.z, s.size.y]);
    const group = new THREE.Group();
    group.name = "inspect-overlay";
    for (const h of props.highlights) {
      // Agent amber, failed-check red, warning orange; picks use the theme's highlight.
      const color =
        h.tone === "agent"
          ? 0xf59e0b
          : h.tone === "fail"
            ? 0xdc2626
            : h.tone === "warn"
              ? 0xf97316
              : palette[props.theme].highlight;
      for (const child of overlayGroup(record, h.faces, scale, color, {
        byPart: true,
      }).children) {
        const part = Number(child.name.slice("part-".length));
        const m = props.pose?.matrices[part];
        if (m) {
          child.matrixAutoUpdate = false;
          child.matrix.copy(sceneMatrix(m, scale));
        }
        group.add(child);
      }
    }
    object.add(group);
    return () => {
      group.removeFromParent();
      group.traverse(disposeMesh);
    };
  }, [props.record, props.highlights, props.theme, props.pose?.key, loaded]);

  // Parts shown where the pose puts them; with no pose, exactly where the build put them.
  useEffect(() => {
    const s = state.current;
    const object = s?.object;
    const record = props.record;
    if (!s || !object) return;
    const scale = record
      ? sceneScale(record, [s.size.x, s.size.z, s.size.y])
      : 1;
    object.updateWorldMatrix(true, false);
    const toObject = object.matrixWorld.clone().invert();
    for (const [node, rest] of s.rest) {
      const index =
        record?.parts.findIndex((p) => nodeName(p.label) === node.name) ?? -1;
      const m = props.pose?.matrices[index];
      let local = rest.clone();
      if (m && node.parent) {
        node.parent.updateWorldMatrix(true, false);
        // The parent's frame relative to the loaded scene, where the record's frame lives.
        const parent = toObject.clone().multiply(node.parent.matrixWorld);
        local = parent
          .clone()
          .invert()
          .multiply(sceneMatrix(m, scale))
          .multiply(parent)
          .multiply(rest);
      }
      local.decompose(node.position, node.quaternion, node.scale);
    }
    object.updateWorldMatrix(true, true);
  }, [props.pose?.key, props.record, loaded]);

  // Dragging a part along its joint: the gesture starts on a part the drag may move.
  useEffect(() => {
    const s = state.current;
    const object = s?.object;
    const record = props.record;
    if (!s || !object || !record || !props.move) return;
    const element = s.renderer.domElement;
    const scale = sceneScale(record, [s.size.x, s.size.z, s.size.y]);
    const rayAt = (e: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        s.camera,
      );
      const from = object.worldToLocal(ray.ray.origin.clone());
      const to = object.worldToLocal(
        ray.ray.origin.clone().add(ray.ray.direction),
      );
      return {
        ray,
        origin: toModel([from.x, from.y, from.z], scale),
        direction: toModel([to.x - from.x, to.y - from.y, to.z - from.z], 1),
      };
    };
    let active: {
      joint: number;
      origin: Vec3;
      axis: Vec3;
      ref?: Vec3;
      start: number;
      last: number;
      total: number;
    } | null = null;
    // Mm along a linear axis, or the angle about a revolute one, measured from where the drag began.
    const measure = (e: PointerEvent) => {
      const a = active!;
      const r = rayAt(e);
      const kind = record.joints![a.joint].kind;
      if (kind === "linear")
        return alongAxis(r.origin, r.direction, a.origin, a.axis);
      return angleAround(r.origin, r.direction, a.origin, a.axis, a.ref!);
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      const value = measure(e);
      if (value === null || !Number.isFinite(value)) return;
      if (record.joints![active.joint].kind === "linear")
        active.total = value - active.start;
      else {
        // Unwrap across ±180° so a long turn keeps counting.
        let step = value - active.last;
        if (step > 180) step -= 360;
        if (step < -180) step += 360;
        active.total += step;
      }
      active.last = value;
      latest.current.move?.onMove(active.total);
    };
    const finish = (commit: boolean) => {
      if (!active) return;
      active = null;
      s.controls.enabled = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (commit) latest.current.move?.onRelease();
      else latest.current.move?.onCancel();
    };
    const up = () => finish(true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    const down = (e: PointerEvent) => {
      const m = latest.current.move;
      if (!m || active) return;
      const r = rayAt(e);
      const hit = r.ray.intersectObject(object, true)[0];
      let node: THREE.Object3D | null = hit?.object ?? null;
      const names = record.parts.map((p) => nodeName(p.label));
      while (node && !names.includes(node.name)) node = node.parent;
      if (!node) return;
      const part = names.indexOf(node.name);
      const joint = record.joints?.findIndex((j) => j.part === part) ?? -1;
      if (joint < 0 || !m.joints.includes(joint)) return;
      const j = record.joints![joint];
      const frame = m.frames[joint];
      const origin = frame ? applyPoint(frame, j.origin) : j.origin;
      const axis = frame ? applyDirection(frame, j.axis) : j.axis;
      // The gesture is the drag's: no orbit, and no click-to-select on release.
      e.stopImmediatePropagation();
      e.preventDefault();
      s.controls.enabled = false;
      const local = object.worldToLocal(hit.point.clone());
      const point = toModel([local.x, local.y, local.z], scale);
      // A turn is measured across the hinge through the grabbed point, so the drag starts exactly
      // where the person took hold and follows the pointer from there.
      const length = Math.hypot(...axis) || 1;
      const along =
        ((point[0] - origin[0]) * axis[0] +
          (point[1] - origin[1]) * axis[1] +
          (point[2] - origin[2]) * axis[2]) /
        length;
      const pivot: Vec3 =
        j.kind === "revolute"
          ? [
              origin[0] + (axis[0] / length) * along,
              origin[1] + (axis[1] / length) * along,
              origin[2] + (axis[2] / length) * along,
            ]
          : origin;
      active = {
        joint,
        origin: pivot,
        axis,
        ref: [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]],
        start: 0,
        last: 0,
        total: 0,
      };
      const first = measure(e);
      active.start = first ?? 0;
      active.last = first ?? 0;
      m.onStart(joint);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    element.addEventListener("pointerdown", down, { capture: true });
    window.addEventListener("keydown", key);
    return () => {
      finish(false);
      element.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("keydown", key);
    };
  }, [!!props.move, props.record, loaded]);

  // A drag handle for a declared dimension: a cone on the face, pointing along its normal.
  useEffect(() => {
    const s = state.current;
    const object = s?.object;
    const record = props.record;
    const h = props.handle;
    if (!s || !object || !record || !h) return;
    const scale = sceneScale(record, [s.size.x, s.size.z, s.size.y]);
    const length = s.size.length() * 0.06;
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(length * 0.3, length, 20),
      new THREE.MeshBasicMaterial({
        color: palette[props.theme].highlight,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    mesh.name = "adjust-handle";
    mesh.renderOrder = 10;
    const direction = new THREE.Vector3(...toScene(h.direction, 1)).normalize();
    mesh.position
      .set(...toScene(h.origin, scale))
      .addScaledVector(direction, length * 0.8);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    object.add(mesh);
    const element = s.renderer.domElement;
    const rayAt = (e: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        s.camera,
      );
      return ray;
    };
    // Pointer position along the handle's axis, in model millimetres.
    const along = (e: PointerEvent) => {
      const ray = rayAt(e).ray;
      const from = object.worldToLocal(ray.origin.clone());
      const to = object.worldToLocal(ray.origin.clone().add(ray.direction));
      return alongAxis(
        toModel([from.x, from.y, from.z], scale),
        toModel([to.x - from.x, to.y - from.y, to.z - from.z], 1),
        h.origin,
        h.direction,
      );
    };
    let start: number | null = null;
    const move = (e: PointerEvent) => {
      if (start !== null) latest.current.handle?.onMove(along(e) - start);
    };
    const finish = (commit: boolean) => {
      if (start === null) return;
      start = null;
      s.controls.enabled = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (commit) latest.current.handle?.onRelease();
      else latest.current.handle?.onCancel();
    };
    const up = () => finish(true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    const down = (e: PointerEvent) => {
      if (!rayAt(e).intersectObject(mesh).length) return;
      // The handle takes the gesture: no orbit, and no click-to-select on release.
      e.stopImmediatePropagation();
      e.preventDefault();
      s.controls.enabled = false;
      start = along(e);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    element.addEventListener("pointerdown", down, { capture: true });
    window.addEventListener("keydown", key);
    return () => {
      finish(false);
      element.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("keydown", key);
      mesh.removeFromParent();
      disposeMesh(mesh);
    };
  }, [props.handle?.key, props.record, props.theme, loaded]);

  // The preview of an action being filled in, in the model's frame.
  useEffect(() => {
    const s = state.current;
    const object = s?.object;
    if (!s || !object || !props.ghost || !props.record) return;
    const scale = sceneScale(props.record, [s.size.x, s.size.z, s.size.y]);
    const ghost = ghostObject(
      props.ghost,
      scale,
      props.theme === "dark" ? 0x34d399 : 0x0f9f6e,
    );
    object.add(ghost);
    return () => {
      ghost.removeFromParent();
      ghost.traverse(disposeMesh);
    };
  }, [props.ghost, props.record, props.theme, loaded]);

  // Section: clip every mesh and fill the cut with stencil caps.
  useEffect(() => {
    const s = state.current;
    const object = s?.object;
    if (!s || !object) return;
    const meshes: THREE.Mesh[] = [];
    object.traverse((o) => {
      // Overlays are clipped too, so a highlight never floats over removed material.
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    const record = props.record;
    if (!props.section || !record) {
      for (const m of meshes)
        for (const material of Array.isArray(m.material)
          ? m.material
          : [m.material])
          material.clippingPlanes = [];
      return;
    }
    const scale = sceneScale(record, [s.size.x, s.size.z, s.size.y]);
    object.updateWorldMatrix(true, true);
    const plane = sectionPlane(
      props.section.axis,
      props.section.offset,
      scale,
    ).applyMatrix4(object.matrixWorld);
    for (const m of meshes)
      for (const material of Array.isArray(m.material)
        ? m.material
        : [m.material])
        material.clippingPlanes = [plane];
    const caps = sectionCaps(
      object,
      plane,
      props.theme === "dark"
        ? [0x9aa0aa, 0xd9a441, 0x6fa8dc, 0x93c47d]
        : [0xb9bcc2, 0xc98f1f, 0x4a86c5, 0x6aa84f],
      s.size.length(),
      record.parts.map((p) => nodeName(p.label)),
    );
    s.scene.add(caps);
    s.caps = caps;
    return () => {
      caps.removeFromParent();
      caps.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name !== "") o.geometry.dispose();
      });
      s.caps = null;
    };
  }, [
    props.section,
    props.record,
    props.theme,
    props.highlights,
    props.pose?.key,
    loaded,
  ]);

  return (
    <div className="viewer">
      <div className="canvas" ref={host} />
      {loading && <div className="viewer-loading">Loading model…</div>}
      {error && (
        <div className="viewer-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
/**
 * A model-frame matrix (mm) as the same motion in the loaded scene's frame: toScene maps
 * (x, y, z) to (x, z, -y) times `scale`, so the scene matrix is S · M · S⁻¹.
 */
function sceneMatrix(m: Mat4, scale: number) {
  const s = new THREE.Matrix4().set(
    scale,
    0,
    0,
    0,
    0,
    0,
    scale,
    0,
    0,
    -scale,
    0,
    0,
    0,
    0,
    0,
    1,
  );
  return s
    .clone()
    .multiply(new THREE.Matrix4().fromArray(m))
    .multiply(s.clone().invert());
}
/** GLTFLoader rewrites node names (spaces become underscores); compare the same way. */
function nodeName(label: string) {
  return THREE.PropertyBinding.sanitizeNodeName(label);
}
function highlight(
  object: THREE.Object3D | null,
  label: string | null,
  color: number,
) {
  const target = label ? nodeName(label) : null;
  object?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let inside = false;
    for (let n: THREE.Object3D | null = o; n; n = n.parent)
      if (target && n.name === target) inside = true;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m instanceof THREE.MeshStandardMaterial) {
        m.emissive.setHex(inside ? color : 0x000000);
        m.emissiveIntensity = inside ? 0.45 : 0;
      }
  });
}
function disposeMesh(object: THREE.Object3D) {
  if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
    object.geometry.dispose();
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      material.dispose();
  }
}
