import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL = "/brand/mantel-name.glb";
const colors = {
  light: {
    name: 0xcfd0cc,
    mark: 0x6366f1,
    grid: 0xdcdcd7,
    gridMajor: 0xc7c7c1,
  },
  dark: { name: 0x9fa3ad, mark: 0x818cf8, grid: 0x2a2c31, gridMajor: 0x3a3d44 },
};
type Props = {
  theme: "light" | "dark";
  /** The sign-in card; the view is offset so the name stays clear of it. */
  avoid: React.RefObject<HTMLElement | null>;
};

/**
 * The Mantel name, modelled in Mantel, on a full-bleed canvas. It turns slowly until someone
 * drags it, and resumes a few seconds after they let go. Zoom and pan are off: it is a toy,
 * not a viewer.
 */
export default function NameStage({ theme, avoid }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const paint = useRef<(t: "light" | "dark") => void>(() => {});
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // Without WebGL the card still works on a plain background.
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    element.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 8000);
    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, {
      enableDamping: true,
      dampingFactor: 0.06,
      enableZoom: false,
      enablePan: false,
      rotateSpeed: 0.8,
      autoRotate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      autoRotateSpeed: 0.6,
      minPolarAngle: 0.35,
      maxPolarAngle: 1.9,
    });
    let idle: ReturnType<typeof setTimeout> | undefined;
    const spinning = controls.autoRotate;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      clearTimeout(idle);
    });
    controls.addEventListener("end", () => {
      idle = setTimeout(() => (controls.autoRotate = spinning), 4000);
    });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(120, 200, 260);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.0);
    rim.position.set(-200, 80, -160);
    scene.add(rim);
    const nameMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.2,
      roughness: 0.42,
    });
    const markMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.1,
      roughness: 0.35,
    });
    let grid: THREE.GridHelper | undefined;
    let floor = 0;
    let distance = 900;
    paint.current = (t) => {
      const c = colors[t];
      nameMaterial.color.setHex(c.name);
      markMaterial.color.setHex(c.mark);
      if (grid) {
        scene.remove(grid);
        grid.dispose();
      }
      grid = new THREE.GridHelper(1600, 64, c.gridMajor, c.grid);
      grid.position.y = floor;
      scene.add(grid);
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim();
      scene.fog = new THREE.Fog(
        background || "#f1f1ee",
        distance,
        distance * 2.6,
      );
    };
    paint.current(theme);

    let width = 570;
    const fit = () => {
      const { width: w, height: h } = element.getBoundingClientRect();
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      const card = avoid.current?.getBoundingClientRect();
      const narrow = w < 760;
      const dx = !narrow && card ? Math.max(0, (w - card.left) / 2) : 0;
      const dy = narrow && card ? Math.max(0, (h - card.top) / 2) : 0;
      camera.setViewOffset(w + 2 * dx, h + 2 * dy, 2 * dx, 2 * dy, w, h);
      const free = (w - 2 * dx) / w;
      const visible =
        2 * Math.tan(THREE.MathUtils.degToRad(16)) * camera.aspect;
      // Leave room for the slow turn: the name fills about half the free width.
      distance = width / (visible * free * (narrow ? 0.72 : 0.5));
      camera.position.set(distance * 0.18, distance * 0.16, distance);
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = distance * 1.05;
        scene.fog.far = distance * 2.6;
      }
      camera.updateProjectionMatrix();
    };
    const resize = new ResizeObserver(fit);
    resize.observe(element);

    let cancelled = false;
    new GLTFLoader().load(MODEL, (gltf) => {
      if (cancelled) return;
      const model = gltf.scene;
      // glTF is in metres; the stage works in the model's millimetres.
      model.scale.setScalar(1000);
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        let inMark = false;
        for (let n: THREE.Object3D | null = o; n; n = n.parent)
          if (n.name === "Mark") inMark = true;
        (o.material as THREE.Material).dispose();
        o.material = inMark ? markMaterial : nameMaterial;
      });
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      width = Math.max(size.x, 1);
      floor = -size.y / 2 - 24;
      if (grid) grid.position.y = floor;
      scene.add(model);
      fit();
    });

    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      resize.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      nameMaterial.dispose();
      markMaterial.dispose();
      grid?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [avoid]);
  useEffect(() => paint.current(theme), [theme]);
  return (
    <div
      className="name-stage"
      ref={host}
      role="img"
      aria-label="The Mantel name in 3D. Drag to spin it."
    />
  );
}
