/* A recorded walkthrough of a project: the steps its demo plays back, each with the phase state
   it leaves and, for the Model phase, the revision it shows. Playback never writes. */
import type { PhaseId, PhaseState } from "./phases";

export type DemoAction = { name: string; ok: boolean; detail: string };
export type DemoStep = {
  phase: PhaseId;
  /** agent: a prompt and the agent's answer; manual: a person's change; system: something Mantel
      or an integration did; message: a conversation with a supplier or the client. */
  kind: "agent" | "manual" | "system" | "message";
  title: string;
  caption: string;
  prompt?: string;
  response?: string;
  actions?: DemoAction[];
  /** The agent model that answered (src/shared/agent-models.ts). */
  model?: string;
  /** The model revision the step shows; 0 before the first. */
  revision: number;
  /** The project's phase state once the step is done. */
  state: PhaseState;
  /** What to point at while the step plays: a CSS selector in the page. */
  focus?: string;
  /** The item the phase shows for this step, such as a supplier thread's id. */
  select?: string;
  /** Mantel's view or the phase engine's. */
  view?: "mantel" | "engine";
  /** How long the step holds before the next, at normal speed. */
  ms?: number;
};
export type DemoScript = {
  version: 1;
  title: string;
  summary: string;
  steps: DemoStep[];
};
