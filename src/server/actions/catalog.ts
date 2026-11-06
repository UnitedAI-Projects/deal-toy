import data from "../../../engine/lib/mantel/catalog.json";
import { AppError } from "../core";

/** A JSON Schema object in the subset `validate.ts` understands. */
export type JsonSchema = Record<string, unknown>;
export type SelectionKind = "face" | "edge" | "plane" | "point" | "part";
export type ActionRecord = {
  id: string;
  version: number;
  title: string;
  category:
    "Create" | "Modify" | "Construct" | "Combine" | "Arrange" | "Custom";
  summary: string;
  description: string;
  inputs: JsonSchema;
  selections: {
    input: string;
    kind: SelectionKind;
    min: number;
    max: number;
  }[];
  creates: Record<string, string>;
  failures: { code: string; explanation: string; fix: string }[];
  preview: "plane" | "cylinder" | "prism" | "text" | "bodies" | "none";
  example: string;
};
export type EngineState =
  "ok" | "warning" | "failed" | "blocked" | "suppressed";
/** One step's result in a build's facts, as the engine's mantel library writes it. */
export type StepLog = {
  name: string;
  action: string;
  version: number;
  state: EngineState;
  code?: string;
  message?: string;
  created: string[];
  ms: number;
};
export type StepStateRecord = {
  state: EngineState | "pending";
  meaning: string;
};

/** The built-in actions. The engine image bundles the same file. */
export const actions = data.actions as ActionRecord[];
export const stepStates = data.states as StepStateRecord[];

export function getAction(id: string): ActionRecord {
  const action = actions.find((a) => a.id === id);
  if (!action) throw new AppError(404, `Unknown action ${id}`);
  return action;
}

/** One line per action, for the agent's always-on context. */
export function catalogIndex(): string {
  return actions.map((a) => `${a.id}@${a.version}: ${a.summary}`).join("\n");
}
