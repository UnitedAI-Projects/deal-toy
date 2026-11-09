import { describe, expect, it } from "vitest";
import boxJson from "../../../engine/tests/fixtures/enclosure_inspect.inspect.json";
import type { FaceRecord, InspectRecord } from "../../shared/inspect-types";
import { signatureOf } from "./evaluate";
import { resolveFace } from "./resolve";

const box = boxJson as unknown as InspectRecord;
const moved = (record: InspectRecord, index: number, dx: number) => ({
  ...record,
  faces: record.faces.map((f): FaceRecord =>
    f.index === index
      ? {
          ...f,
          center: [f.center[0] + dx, f.center[1], f.center[2]],
          plane: f.plane && {
            ...f.plane,
            origin: [
              f.plane.origin[0] + dx,
              f.plane.origin[1],
              f.plane.origin[2],
            ],
          },
        }
      : f,
  ),
});

describe("resolveFace", () => {
  it("follows a step-created name, then a part side", () => {
    const named = {
      ...box,
      faces: box.faces.map((f) =>
        f.index === 12 ? { ...f, names: [{ of: "Boss", name: "top" }] } : f,
      ),
    };
    const target = {
      ...signatureOf(box, 30),
      ref: { ref: "face", of: "Boss", name: "top" },
    };
    expect(resolveFace(named, target)).toEqual({ index: 12 });
    const sided = {
      ...box,
      faces: box.faces.map((f) =>
        f.index === 3 ? { ...f, sides: ["bottom"] } : f,
      ),
    };
    expect(
      resolveFace(sided, {
        ...signatureOf(box, 30),
        ref: { ref: "face", of: "Housing", name: "bottom" },
      }),
    ).toEqual({ index: 3 });
  });

  it("finds a face by its signature after the face moved 3 mm", () => {
    const target = signatureOf(box, 47);
    expect(resolveFace(moved(box, 47, 3), target)).toEqual({ index: 47 });
  });

  it("refuses when two faces match equally", () => {
    const target = signatureOf(box, 47);
    const twin = {
      ...box,
      faces: [
        ...box.faces.map((f) =>
          f.index === 47
            ? { ...f, center: [37.7, 10, 28.5] as FaceRecord["center"] }
            : f,
        ),
        {
          ...box.faces[47],
          index: box.faces.length,
          center: [37.7, -10, 28.5] as FaceRecord["center"],
        },
      ],
    };
    expect(resolveFace(twin, target)).toEqual({
      unknown: "Re-pick needed: more than one face matches",
    });
  });

  it("never jumps to another face when the picked one is deleted", () => {
    const target = signatureOf(box, 19);
    const deleted = { ...box, faces: box.faces.filter((f) => f.index !== 19) };
    expect(resolveFace(deleted, target)).toEqual({
      unknown: "Re-pick needed: the face is gone",
    });
  });
});
