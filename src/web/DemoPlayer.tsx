/* Plays a project's recorded demo (src/shared/demo.ts) over the real project views: each step
   sets the phase, the phase state and the model revision shown, and the agent panel replays the
   step's conversation. Playback is read-only: it never writes to the project. */
import { useEffect, useRef, useState } from "react";
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

/** How long a step holds at normal speed: long enough to read what it shows. */
export function stepDuration(step: DemoStep) {
  if (step.ms) return step.ms;
  const reading =
    (step.response?.length ?? 0) * 22 + (step.prompt?.length ?? 0) * 30;
  return Math.max(5500, Math.min(16000, 3500 + reading));
}

export function useDemo(script: DemoScript | null) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const steps = script?.steps ?? [];
  const step = steps[Math.min(index, Math.max(0, steps.length - 1))];
  useEffect(() => setStartedAt(Date.now()), [index]);
  useEffect(() => {
    if (!script || !playing || index >= steps.length - 1) return;
    const timer = setTimeout(
      () => setIndex((i) => i + 1),
      stepDuration(steps[index]) / speed,
    );
    return () => clearTimeout(timer);
  }, [script, playing, index, speed]);
  return {
    script,
    step,
    index,
    count: steps.length,
    playing,
    speed,
    startedAt,
    go: (i: number) => setIndex(Math.max(0, Math.min(steps.length - 1, i))),
    toggle: () => {
      if (index >= steps.length - 1) {
        setIndex(0);
        setPlaying(true);
      } else setPlaying((p) => !p);
    },
    setSpeed,
  };
}
export type Demo = ReturnType<typeof useDemo>;

export function DemoBar(props: { demo: Demo; onExit: () => void }) {
  const { demo } = props;
  const step = demo.step;
  if (!demo.script || !step) return null;
  const phase = PHASES.find((p) => p.id === step.phase)?.label ?? step.phase;
  return (
    <div className="demo-bar" role="region" aria-label="Demo playback">
      <div className="demo-progress" aria-hidden="true">
        {demo.script.steps.map((s, i) => (
          <button
            key={i}
            className={`demo-tick ${i < demo.index ? "done" : ""} ${i === demo.index ? "on" : ""} phase-${s.phase}`}
            title={`${i + 1}. ${s.title}`}
            onClick={() => demo.go(i)}
            tabIndex={-1}
          />
        ))}
      </div>
      <div className="demo-main">
        <div className="demo-controls">
          <button
            className="icon ghost"
            aria-label="Previous step"
            onClick={() => demo.go(demo.index - 1)}
            disabled={demo.index === 0}
          >
            ⏮
          </button>
          <button
            className="icon"
            aria-label={demo.playing ? "Pause" : "Play"}
            onClick={demo.toggle}
          >
            {demo.playing && demo.index < demo.count - 1 ? "⏸" : "▶"}
          </button>
          <button
            className="icon ghost"
            aria-label="Next step"
            onClick={() => demo.go(demo.index + 1)}
            disabled={demo.index >= demo.count - 1}
          >
            ⏭
          </button>
        </div>
        <div className="demo-text">
          <div className="demo-meta">
            <span className={`demo-kind kind-${step.kind}`}>
              {KIND_LABEL[step.kind]}
              {step.kind === "agent" && step.model
                ? ` · ${agentModel(step.model).label}`
                : ""}
            </span>
            <span className="muted small">
              {phase} · step {demo.index + 1} of {demo.count}
              {step.revision ? ` · r${step.revision}` : ""}
            </span>
          </div>
          <strong className="demo-title">{step.title}</strong>
          <span className="demo-caption">{step.caption}</span>
        </div>
        <div className="demo-side">
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
          <button className="secondary" onClick={props.onExit}>
            Exit demo
          </button>
          <span className="muted small demo-note">
            Recorded walkthrough · nothing here changes the project
          </span>
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
