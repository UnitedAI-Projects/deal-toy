import { AppError } from "../core";
import type { Step, StepValue } from "./script";

/** One change to a model's steps. Every write tool is one of these. */
export type StepChange =
  | { op: "add"; step: Omit<Step, "suppressed" | "raw">; after?: string }
  | { op: "edit"; name: string; inputs: Record<string, StepValue> }
  | { op: "remove"; name: string }
  | { op: "move"; name: string; after: string | null }
  | { op: "suppress"; name: string; suppressed: boolean }
  | { op: "rename"; name: string; newName: string };

const VALID_NAME = /^[^"\\\n]{1,80}$/;

function index(steps: Step[], name: string) {
  const i = steps.findIndex((s) => s.name === name);
  if (i === -1) throw new AppError(404, `No step named "${name}"`);
  return i;
}

/** Refuses a name that is invalid or already used by another step or by a part not made by a step. */
function checkName(
  steps: Step[],
  name: string,
  partLabels: string[],
  except?: string,
) {
  if (!VALID_NAME.test(name))
    throw new AppError(
      400,
      "Step names are 1 to 80 characters without quotes, backslashes or line breaks",
    );
  // A body step's name is the label of the part it makes, so that label is the step's own.
  const madeBySteps = new Set(
    steps.filter((s) => s.action === "body").map((s) => s.name),
  );
  const taken = new Set([
    ...steps.map((s) => s.name).filter((n) => n !== except),
    ...partLabels.filter((l) => !madeBySteps.has(l)),
  ]);
  if (taken.has(name))
    throw new AppError(409, `A step or part is already named "${name}"`);
}

/** A step value with references to step or part `from` renamed to `to`. */
export function renameIn(
  value: StepValue,
  from: string,
  to: string,
): StepValue {
  if (Array.isArray(value)) return value.map((v) => renameIn(v, from, to));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, StepValue> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = renameIn(v as StepValue, from, to);
  if ("ref" in value) {
    if ((value.ref === "face" || value.ref === "edges") && out.of === from)
      out.of = to;
    if (value.ref === "datum" && out.name === from) out.name = to;
    if (value.ref === "part" && out.label === from) out.label = to;
  }
  return out;
}

/** Applies one change and returns a new list; the input list is never modified. */
export function applyStepChange(
  steps: Step[],
  change: StepChange,
  partLabels: string[],
): Step[] {
  const next = [...steps];
  switch (change.op) {
    case "add": {
      checkName(steps, change.step.name, partLabels);
      const at =
        change.after === undefined
          ? next.length
          : index(steps, change.after) + 1;
      next.splice(at, 0, { ...change.step, suppressed: false });
      return next;
    }
    case "edit": {
      const i = index(steps, change.name);
      next[i] = { ...steps[i], inputs: change.inputs };
      return next;
    }
    case "remove":
      next.splice(index(steps, change.name), 1);
      return next;
    case "move": {
      const i = index(steps, change.name);
      if (change.after === change.name)
        throw new AppError(400, "A step cannot move after itself");
      const [step] = next.splice(i, 1);
      const at = change.after === null ? 0 : index(next, change.after) + 1;
      next.splice(at, 0, step);
      return next;
    }
    case "suppress": {
      const i = index(steps, change.name);
      next[i] = { ...steps[i], suppressed: change.suppressed };
      return next;
    }
    case "rename": {
      const i = index(steps, change.name);
      checkName(steps, change.newName, partLabels, change.name);
      next[i] = { ...steps[i], name: change.newName };
      for (let j = i + 1; j < next.length; j++)
        next[j] = {
          ...next[j],
          inputs: renameIn(
            next[j].inputs,
            change.name,
            change.newName,
          ) as Record<string, StepValue>,
        };
      return next;
    }
  }
}

/** The activity-log message for a change. */
export function describeChange(change: StepChange): string {
  switch (change.op) {
    case "add":
      return `Added ${change.step.action} "${change.step.name}"`;
    case "edit":
      return `Changed step "${change.name}"`;
    case "remove":
      return `Removed step "${change.name}"`;
    case "move":
      return change.after === null
        ? `Moved step "${change.name}" to the start`
        : `Moved step "${change.name}" after "${change.after}"`;
    case "suppress":
      return `Turned ${change.suppressed ? "off" : "on"} step "${change.name}"`;
    case "rename":
      return `Renamed step "${change.name}" to "${change.newName}"`;
  }
}
