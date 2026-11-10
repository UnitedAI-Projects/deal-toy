import { describe, expect, it } from "vitest";
import * as THREE from "three";
import fitJson from "../../engine/tests/fixtures/display_box_fit.inspect.json";
import type { InspectRecord } from "../shared/inspect-types";
import { overlayGroup, sectionCaps } from "./overlays";

const fit = fitJson as unknown as InspectRecord;
const facesOf = (part: number) =>
  fit.faces.filter((f) => f.part === part).map((f) => f.index);

describe("overlayGroup", () => {
  it("splits highlights into one group per part, so each can move with its part", () => {
    const picked = [...facesOf(1).slice(0, 2), ...facesOf(2).slice(0, 3)];
    const group = overlayGroup(fit, picked, 1, 0xff0000, { byPart: true });
    expect(group.children.map((c) => c.name)).toEqual(["part-1", "part-2"]);
    expect(group.children.map((c) => c.children.length)).toEqual([2, 3]);
  });
  it("keeps the flat form by default", () => {
    const group = overlayGroup(fit, facesOf(1).slice(0, 2), 1, 0xff0000);
    expect(group.children).toHaveLength(2);
  });
});

describe("sectionCaps", () => {
  it("leaves per-part highlight meshes out of the cut", () => {
    const scene = new THREE.Group();
    const part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    part.name = "Lid";
    scene.add(part);
    scene.add(
      overlayGroup(fit, facesOf(1).slice(0, 2), 1, 0xff0000, { byPart: true }),
    );
    const caps = sectionCaps(
      scene,
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      [0x999999],
      10,
      ["Lid"],
    );
    // One part: a back and a front stencil mesh, and one cap.
    expect(caps.children).toHaveLength(3);
  });
});
