import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { request } from "./api";
export function Viewer({ artifactId }: { artifactId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setError("");
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("3D preview requires WebGL. You can still download the model.");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eeeae3");
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10000);
    camera.position.set(150, 110, 170);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(80, 150, 100);
    scene.add(light);
    const grid = new THREE.GridHelper(240, 24, 0xc3b8a8, 0xdbd3c7);
    scene.add(grid);
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
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
    if (artifactId)
      void request(`/api/artifacts/${artifactId}`)
        .then((r) => r.arrayBuffer())
        .then((data) => new GLTFLoader().parseAsync(data, ""))
        .then((gltf) => {
          if (disposed) {
            gltf.scene.traverse(disposeMesh);
            return;
          }
          const object = gltf.scene;
          scene.add(object);
          const box = new THREE.Box3().setFromObject(object);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3()).length();
          object.position.sub(center);
          object.position.y += box.getSize(new THREE.Vector3()).y / 2;
          const target = new THREE.Vector3(
            0,
            box.getSize(new THREE.Vector3()).y / 2,
            0,
          );
          controls.target.copy(target);
          camera.position
            .copy(target)
            .add(new THREE.Vector3(size * 1.2, size * 0.8, size * 1.3));
          camera.near = Math.max(0.01, size / 1000);
          camera.far = size * 100;
          camera.updateProjectionMatrix();
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      scene.traverse(disposeMesh);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [artifactId]);
  return (
    <div className="viewer">
      <div className="canvas" ref={host} />
      <div className="viewer-label">
        PERSPECTIVE <span>·</span> mm
      </div>
      {!artifactId && (
        <div className="viewer-empty">
          <span className="large-symbol">◇</span>
          <h3>Your design starts here</h3>
          <p>Save and build a model to explore it in 3D.</p>
        </div>
      )}
      {error && (
        <div className="viewer-error" role="alert">
          {error}
        </div>
      )}
      <div className="viewer-controls">
        Drag to orbit · Scroll to zoom · Right-drag to pan
      </div>
    </div>
  );
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
