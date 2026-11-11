/* Plays a project's recorded demo (src/shared/demo.ts) over the real project views: each step
   sets the phase, the phase state and the model revision shown, and the agent panel replays the
   step's conversation. Playback is read-only: it never writes to the project. */
import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { DemoScript, DemoStep } from "../shared/demo";
import { PHASES } from "./phases";
import { agentModel } from "../shared/agent-models";

const SPEEDS = [0.5, 1, 1.5, 2] as const;
const KIND_LABEL: Record<DemoStep["kind"], string> = {
  agent: "Agent",
  manual: "Manual change",
  system: "Mantel",
  message: "Conversation",
};

/** The whole demo plays in this long at normal speed, however many steps it has. */
export const DEMO_TOTAL_MS = 60_000;

/** A step's share of the demo: its own length relative to the others (more text, more time). */
export function stepWeight(step: DemoStep) {
  if (step.ms) return step.ms;
  const reading =
    (step.response?.length ?? 0) * 22 + (step.prompt?.length ?? 0) * 30;
  return Math.max(5500, Math.min(16000, 3500 + reading));
}

/** When a step's change lands, as a share of its time. An agent's answer has finished streaming
    by 0.8 of its step (src/web/PhaseAgent.tsx). */
export const APPLY_AGENT = 0.8;
export const APPLY_OTHER = 0.35;

/** Each step's time at normal speed, scaled so the steps together take DEMO_TOTAL_MS. */
export function stepDurations(steps: DemoStep[]) {
  const weights = steps.map(stepWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (w / total) * DEMO_TOTAL_MS);
}

export function useDemo(script: DemoScript | null) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  // Whether the controls are showing; kept here so a change of phase keeps them as they were.
  const [open, setOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const steps = script?.steps ?? [];
  const step = steps[Math.min(index, Math.max(0, steps.length - 1))];
  const durations = stepDurations(steps);
  const duration = (durations[index] ?? 2000) / speed;
  // A step starts from where the last one left off; its own change lands partway through it:
  // an agent's once its answer has finished, a person's or Mantel's a little after it begins.
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    setStartedAt(Date.now());
    setApplied(false);
  }, [index]);
  useEffect(() => {
    if (!script || !playing || index >= steps.length - 1) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), duration);
    return () => clearTimeout(timer);
  }, [script, playing, index, speed]);
  useEffect(() => {
    if (!step) return;
    const at = duration * (step.kind === "agent" ? APPLY_AGENT : APPLY_OTHER);
    const timer = setTimeout(() => setApplied(true), at);
    return () => clearTimeout(timer);
  }, [index, script, speed]);
  return {
    script,
    step,
    index,
    count: steps.length,
    playing,
    speed,
    startedAt,
    /** How long the step now showing plays, at the current speed. */
    duration,
    /** Whether the step's change has landed yet (before it, the previous step's state shows). */
    applied,
    go: (i: number) => setIndex(Math.max(0, Math.min(steps.length - 1, i))),
    /** Jump to a phase's first step and play on from there. */
    goPhase: (phase: string) => {
      const first = steps.findIndex((s) => s.phase === phase);
      if (first >= 0) {
        setIndex(first);
        setPlaying(true);
      }
    },
    toggle: () => {
      if (index >= steps.length - 1) {
        setIndex(0);
        setPlaying(true);
      } else setPlaying((p) => !p);
    },
    setSpeed,
    open,
    setOpen,
  };
}
export type Demo = ReturnType<typeof useDemo>;

/** The playback controls: a small pill in the corner; open it for the step's caption and more. */
export function DemoBar(props: { demo: Demo; onExit: () => void }) {
  const { demo } = props;
  const { open, setOpen } = demo;
  const step = demo.step;
  if (!demo.script || !step) return null;
  const phase = PHASES.find((p) => p.id === step.phase)?.label ?? step.phase;
  const progress = demo.count > 1 ? demo.index / (demo.count - 1) : 1;
  const playing = demo.playing && demo.index < demo.count - 1;
  // Closed, the player is a small ring in the corner: progress around it, play or pause inside.
  if (!open)
    return (
      <div className="demo-mini" role="region" aria-label="Demo playback">
        <button
          className="demo-ring"
          style={{ "--p": `${progress * 360}deg` } as React.CSSProperties}
          aria-label={playing ? "Pause the demo" : "Play the demo"}
          title={`${demo.index + 1}/${demo.count} · ${step.title}`}
          onClick={demo.toggle}
        >
          <span>{playing ? "⏸" : "▶"}</span>
        </button>
        <button
          className="demo-mini-count"
          aria-label="Show the demo controls"
          title="Show the demo controls"
          onClick={() => setOpen(true)}
        >
          {demo.index + 1}/{demo.count}
        </button>
      </div>
    );
  return (
    <div className="demo-dock" role="region" aria-label="Demo playback">
      <div className="demo-line" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="demo-detail">
        <div className="demo-meta">
          <span className={`demo-kind kind-${step.kind}`}>
            {KIND_LABEL[step.kind]}
            {step.kind === "agent" && step.model
              ? ` · ${agentModel(step.model).label}`
              : ""}
          </span>
          <span className="muted small">
            {phase}
            {step.revision ? ` · r${step.revision}` : ""}
          </span>
          <button
            className="icon ghost demo-hide"
            aria-label="Hide the demo controls"
            title="Hide"
            onClick={() => setOpen(false)}
          >
            –
          </button>
        </div>
        <strong className="demo-title">{step.title}</strong>
        <span className="demo-caption">{step.caption}</span>
        <div className="demo-ticks">
          {demo.script.steps.map((s, i) => (
            <button
              key={i}
              className={`demo-tick ${i < demo.index ? "done" : ""} ${i === demo.index ? "on" : ""}`}
              title={`${i + 1}. ${s.title}`}
              aria-label={`Step ${i + 1}: ${s.title}`}
              onClick={() => demo.go(i)}
            />
          ))}
        </div>
        <div className="demo-foot">
          <button
            className="icon ghost"
            aria-label="Previous step"
            onClick={() => demo.go(demo.index - 1)}
            disabled={demo.index === 0}
          >
            ⏮
          </button>
          <button
            className="icon ghost"
            aria-label={playing ? "Pause" : "Play"}
            onClick={demo.toggle}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            className="icon ghost"
            aria-label="Next step"
            onClick={() => demo.go(demo.index + 1)}
            disabled={demo.index >= demo.count - 1}
          >
            ⏭
          </button>
          <span className="demo-count">
            {demo.index + 1}/{demo.count}
          </span>
          <select
            aria-label="Playback speed"
            value={demo.speed}
            onChange={(e) =>
              demo.setSpeed(Number(e.target.value) as typeof demo.speed)
            }
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button className="link" onClick={props.onExit}>
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}

/** A soft ring around what the step is about, following it as the page lays out. */
export function DemoFocus(props: { selector?: string; stepKey: number }) {
  const [box, setBox] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    setBox(null);
    if (!props.selector) return;
    const measure = () => {
      let el: Element | null = null;
      try {
        el = document.querySelector(props.selector!);
      } catch {
        el = null;
      }
      const rect = el?.getBoundingClientRect();
      setBox(rect && rect.width > 0 && rect.height > 0 ? rect : null);
    };
    measure();
    timer.current = setInterval(measure, 400);
    return () => clearInterval(timer.current);
  }, [props.selector, props.stepKey]);
  if (!box) return null;
  return (
    <div
      className="demo-focus"
      aria-hidden="true"
      style={{
        left: box.left - 6,
        top: box.top - 6,
        width: box.width + 12,
        height: box.height + 12,
      }}
    />
  );
}
