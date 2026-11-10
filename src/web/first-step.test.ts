import { describe, expect, it } from "vitest";
import { addStepTo } from "./first-step";

function fakeApi(refuseStep: boolean) {
  const calls: string[] = [];
  const call = async <T>(name: string, _input: unknown): Promise<T> => {
    calls.push(name);
    if (name === "models_create") return { id: "m1" } as T;
    if (name === "steps_add" && refuseStep) throw new Error("Size is required");
    return {} as T;
  };
  return { call, calls };
}
const step = { action: "body", name: "Block", inputs: {} };

describe("addStepTo", () => {
  it("creates the model first in a project that has none", async () => {
    const api = fakeApi(false);
    const models: string[] = [];
    await addStepTo(
      api.call,
      { projectId: "p", expectedRevision: 0 },
      step,
      (id) => {
        models.push(id);
      },
    );
    expect(api.calls).toEqual(["models_create", "steps_add"]);
    expect(models).toEqual(["m1"]);
  });
  it("reports the new model even when the step is refused, so a retry reuses it", async () => {
    const api = fakeApi(true);
    const models: string[] = [];
    await expect(
      addStepTo(
        api.call,
        { projectId: "p", expectedRevision: 0 },
        step,
        (id) => {
          models.push(id);
        },
      ),
    ).rejects.toThrow("Size is required");
    expect(models).toEqual(["m1"]);
  });
  it("adds to an existing model without creating one", async () => {
    const api = fakeApi(false);
    await addStepTo(
      api.call,
      { projectId: "p", modelId: "m0", expectedRevision: 3 },
      step,
      () => {
        throw new Error("not called");
      },
    );
    expect(api.calls).toEqual(["steps_add"]);
  });
});
