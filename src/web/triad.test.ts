import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { triadVectors } from "./triad";

const quat = (q: THREE.Quaternion) =>
  [q.x, q.y, q.z, q.w] as [number, number, number, number];
const len = ([x, y]: [number, number]) => Math.hypot(x, y);

describe("triadVectors", () => {
  it("shows X right and Y up when looking straight down the model's Z", () => {
    // Model Z is scene +Y and model Y is scene -Z, so the camera looks down scene -Y with
    // its up along scene -Z.
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1, 0),
    );
    const v = triadVectors(
      quat(new THREE.Quaternion().setFromRotationMatrix(basis)),
    );
    expect(v.X[0]).toBeCloseTo(1);
    expect(v.X[1]).toBeCloseTo(0);
    expect(v.Y[0]).toBeCloseTo(0);
    expect(v.Y[1]).toBeCloseTo(1);
    expect(len(v.Z)).toBeLessThan(0.01);
  });
  it("points Z up the screen from the default camera", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(160, 110, 180);
    camera.lookAt(0, 0, 0);
    const v = triadVectors(quat(camera.quaternion));
    expect(v.Z[1]).toBeGreaterThan(0);
    expect(v.X[0]).toBeGreaterThan(0);
  });
});
