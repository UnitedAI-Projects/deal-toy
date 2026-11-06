import catalog from "../../engine/lib/mantel/catalog.json";
import type { StepLog } from "./api";

export type ChipState = StepLog["state"] | "pending";
export type Chip = {
  name: string;
  action: string;
  title: string;
  state: ChipState;
  tone: "ok" | "warn" | "bad" | "muted";
  meaning: string;
  detail: string;
};
const TONES: Record<ChipState, Chip["tone"]> = {
  ok: "ok",
  warning: "warn",
  failed: "bad",
  blocked: "bad",
  suppressed: "muted",
  pending: "muted",
};
const meanings = new Map(catalog.states.map((s) => [s.state, s.meaning]));

/** What the timeline shows for each step of a build; while a newer build runs, steps are pending. */
export function timelineChips(steps: StepLog[], building: boolean): Chip[] {
  return steps.map((step) => {
    const action = catalog.actions.find((a) => a.id === step.action);
    const failure = action?.failures.find((f) => f.code === step.code);
    const known = [
      step.message,
      failure && `${failure.explanation} ${failure.fix}`,
    ]
      .filter(Boolean)
      .join(" ");
    const state: ChipState = building ? "pending" : step.state;
    return {
      name: step.name,
      action: step.action,
      title: action?.title ?? step.action,
      state,
      tone: TONES[state],
      meaning: meanings.get(state) ?? "",
      detail: building ? `Last build: ${step.state}. ${known}`.trim() : known,
    };
  });
}
