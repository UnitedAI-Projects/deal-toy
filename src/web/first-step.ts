type Call = <T>(name: string, input: unknown) => Promise<T>;

/**
 * Adds a step, first creating the project's model when it has none. `onModel` runs as soon as
 * the new model exists, before the step is sent, so a retry after a refused step reuses it
 * instead of creating another.
 */
export async function addStepTo(
  call: Call,
  target: { projectId: string; modelId?: string; expectedRevision: number },
  step: { action: string; name: string; inputs: unknown },
  onModel: (id: string) => void | Promise<void>,
) {
  let modelId = target.modelId;
  if (!modelId) {
    modelId = (
      await call<{ id: string }>("models_create", {
        projectId: target.projectId,
        name: "Model 01",
      })
    ).id;
    await onModel(modelId);
  }
  return call("steps_add", {
    modelId,
    expectedRevision: target.expectedRevision,
    ...step,
  });
}
