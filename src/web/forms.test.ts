import { describe, expect, it } from "vitest";
import catalog from "../../engine/lib/mantel/catalog.json";
import { fieldsFor, submitValues, type ActionSchema } from "./forms";

const action = (id: string) =>
  catalog.actions.find((a) => a.id === id) as unknown as ActionSchema;
const field = (fields: ReturnType<typeof fieldsFor>, name: string) =>
  fields.find((f) => f.name === name)!;
const on = { ref: "face", of: "Base", name: "bottom" };

describe("fieldsFor", () => {
  it("describes the hole's inputs", () => {
    const fields = fieldsFor(action("hole"), {});
    expect(field(fields, "on")).toMatchObject({
      kind: "ref",
      required: true,
      refKinds: ["face"],
      visible: true,
    });
    expect(field(fields, "diameter")).toMatchObject({
      kind: "number",
      unit: "mm",
      min: 0.2,
      max: 200,
      required: true,
    });
    expect(field(fields, "kind")).toMatchObject({
      kind: "choice",
      default: "simple",
      options: ["simple", "counterbore", "countersink"],
    });
    expect(field(fields, "at")).toMatchObject({
      kind: "vec3",
      required: false,
      visible: true,
    });
    expect(field(fields, "depth")).toMatchObject({
      visible: true,
      required: true,
    });
  });
  it("shows variant fields only for their variant", () => {
    expect(field(fieldsFor(action("hole"), {}), "cb_diameter").visible).toBe(
      false,
    );
    const counterbore = fieldsFor(action("hole"), { kind: "counterbore" });
    expect(field(counterbore, "cb_diameter")).toMatchObject({
      visible: true,
      required: true,
    });
    expect(
      field(fieldsFor(action("hole"), { extent: "through" }), "depth").visible,
    ).toBe(false);
    expect(
      field(fieldsFor(action("hole"), { extent: "up_to" }), "up_to").visible,
    ).toBe(true);
  });
  it("submits only visible, filled values, keeping parameter references", () => {
    expect(
      submitValues(action("hole"), {
        on,
        diameter: { param: "HOLE_D" },
        kind: "simple",
        cb_diameter: 9,
        extent: "through",
        depth: 4,
        at: undefined,
      }),
    ).toEqual({
      on,
      diameter: { param: "HOLE_D" },
      kind: "simple",
      extent: "through",
    });
  });
  it("uses a saved action's own record", () => {
    const saved = {
      id: "finger-notch@1",
      inputs: {
        type: "object",
        properties: {
          on: { "x-ref": "face", description: "Face" },
          width: {
            type: "number",
            unit: "mm",
            minimum: 4,
            maximum: 40,
            description: "Width",
          },
        },
        required: ["on", "width"],
        additionalProperties: false,
      },
    } as unknown as ActionSchema;
    expect(
      fieldsFor(saved, {}).map((f) => [f.name, f.kind, f.required]),
    ).toEqual([
      ["on", "ref", true],
      ["width", "number", true],
    ]);
  });
  it("lists two picked faces for a midplane", () => {
    const between = field(
      fieldsFor(action("plane"), { method: "midplane" }),
      "between",
    );
    expect(between).toMatchObject({
      kind: "list",
      refKinds: ["face"],
      count: 2,
      visible: true,
      required: true,
    });
  });
});
