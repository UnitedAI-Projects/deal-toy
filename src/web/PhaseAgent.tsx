import { useEffect, useRef, useState } from "react";
import { request, send } from "./api";
import { agentGuide, PHASES, type PhaseId, type PhaseState } from "./phases";
import {
  AGENT_MODELS,
  agentModel,
  DEFAULT_AGENT_MODEL,
  type AgentModelId,
} from "../shared/agent-models";

const MODEL_KEY = "mantel.agentModel";
/** The model this person last chose (a per-browser convenience). */
function savedModel(): AgentModelId {
  try {
    return agentModel(localStorage.getItem(MODEL_KEY)).id;
  } catch {
    return DEFAULT_AGENT_MODEL;
  }
}

export type Turn = {
  id: string;
  prompt: string;
  response: string;
  status: string;
  actions: { name: string; ok: boolean; detail: string }[];
  model?: string | null;
};
export type PlaybackTurns = {
  turns: Turn[];
  /** The step now playing, when it is this phase's newest turn: typed, then answered. */
  live?: { id: string; startedAt: number };
};
export function PhaseAgent(props: {
  phase: PhaseId;
  state: PhaseState;
  latestRevision: number;
  projectId: string;
  canNote: boolean;
  onSuggestion: (text: string) => boolean;
  /** A recorded demo: show these turns instead of the project's conversation. Read-only. */
  playback?: PlaybackTurns;
}) {
  // Remount the conversation when its project/phase changes; in-flight answers cannot leak
  // into the next phase. The server retains the original turn even after navigation.
  return <Conversation key={props.projectId + ":" + props.phase} {...props} />;
}
/** Milliseconds since `start`, ticking while a demo step plays. */
function useElapsed(start: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(timer);
  }, [start]);
  return start === undefined ? Infinity : now - start;
}
function Conversation(props: Parameters<typeof PhaseAgent>[0]) {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<AgentModelId>(savedModel);
  const choose = (id: AgentModelId) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* The choice lasts for this page only. */
    }
  };
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const generation = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const path = `/api/projects/${props.projectId}/agent`;
  const guide = agentGuide(props.state, props.phase, props.latestRevision);
  const label = PHASES.find((p) => p.id === props.phase)!.label;
  const elapsed = useElapsed(props.playback?.live?.startedAt);
  useEffect(() => {
    if (!props.canNote || props.playback) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const started = generation.current;
      try {
        const result = (await (
          await request(path + "?phase=" + props.phase)
        ).json()) as { turns: Turn[] };
        if (disposed) return;
        if (!inFlight.current && generation.current === started)
          setTurns(result.turns);
        // Recover a request that continued after the person navigated away.
        if (result.turns.some((t) => t.status === "running"))
          timer = setTimeout(load, 3000);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [path, props.phase, props.canNote]);
  // A demo's turns, the newest one played out: its prompt typed, a pause, then the answer.
  const shown = props.playback
    ? props.playback.turns.map((t) => {
        if (t.id !== props.playback!.live?.id) return t;
        const typed = Math.max(0, elapsed - 300);
        const prompting = typed < t.prompt.length * 28;
        const thinking = elapsed - 300 - t.prompt.length * 28;
        if (prompting) return null;
        if (thinking < 1600) return { ...t, status: "running", response: "" };
        const chars = Math.floor((thinking - 1600) / 9);
        return {
          ...t,
          response: t.response.slice(0, chars),
          actions: chars >= t.response.length ? t.actions : [],
        };
      })
    : turns;
  const playingPrompt = (() => {
    const live = props.playback?.turns.find(
      (t) => t.id === props.playback?.live?.id,
    );
    if (!live) return "";
    const typed = Math.max(0, elapsed - 300);
    return typed < live.prompt.length * 28
      ? live.prompt.slice(0, Math.floor(typed / 28))
      : "";
  })();
  const visible = shown.filter((t): t is Turn => t !== null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, visible.length, visible.at(-1)?.response.length]);
  async function submit() {
    const message = text.trim();
    if (!message || inFlight.current || !props.canNote) return;
    const id = crypto.randomUUID();
    inFlight.current = true;
    generation.current += 1;
    setBusy(true);
    setError("");
    setText("");
    setTurns((t) => [
      ...t,
      {
        id,
        prompt: message,
        response: "",
        status: "running",
        actions: [],
        model,
      },
    ]);
    try {
      const result = await send<Turn>(path, "POST", {
        id,
        phase: props.phase,
        message,
        model,
      });
      setTurns((t) => t.map((old) => (old.id === id ? result : old)));
    } catch (e) {
      setError((e as Error).message);
      // A disconnected response does not imply its actions failed. Reload receipts.
      try {
        const saved = (await (
          await request(path + "?phase=" + props.phase)
        ).json()) as { turns: Turn[] };
        setTurns(saved.turns);
      } catch {
        /* Keep the visible prompt and explicit uncertainty. */
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button className="chip agent-chip" onClick={() => setOpen(true)}>
        Mantel agent
      </button>
    );
  return (
    <aside
      className={`phase-agent ${visible.length ? "has-conversation" : ""} ${props.playback ? "playback" : ""}`}
      aria-label="Agent"
    >
      <div className="phase-agent-head">
        <strong>Mantel agent</strong>
        <span className="muted small">In {label}</span>
        <select
          className="agent-model"
          aria-label="Agent model"
          value={
            props.playback
              ? agentModel(
                  props.playback.turns.at(-1)?.model ?? DEFAULT_AGENT_MODEL,
                ).id
              : model
          }
          disabled={busy || !!props.playback}
          onChange={(e) => choose(e.target.value as AgentModelId)}
          title={`Runs on ${agentModel(model).via}`}
        >
          {AGENT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.via}
            </option>
          ))}
        </select>
        <button
          className="link"
          aria-label="Hide the agent"
          onClick={() => setOpen(false)}
        >
          Hide
        </button>
      </div>
      <div className="phase-agent-log" ref={list} aria-live="polite">
        <div className="agent-msg peek">
          <div className="agent-who">Mantel · guide</div>
          {guide.text}
        </div>
        {!visible.length && !props.playback && (
          <div className="quick">
            {guide.suggestions.map((s) => (
              <button
                key={s}
                className="secondary"
                onClick={() => {
                  if (!props.onSuggestion(s)) setText(s);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {visible.map((t) => (
          <div key={t.id} className="agent-turn">
            <div className="my-msg">{t.prompt}</div>
            <div className="agent-msg">
              <div className="agent-who">
                Mantel{t.model ? ` · ${agentModel(t.model).label}` : ""}
              </div>
              {t.status === "running" ? (
                props.playback ? (
                  <span className="thinking">Thinking…</span>
                ) : (
                  "Working… If interrupted, reload to check saved actions."
                )
              ) : (
                t.response
              )}
              {t.actions.map((a, i) => (
                <div
                  className={`small agent-action ${a.ok ? "" : "error"}`}
                  key={i}
                >
                  {a.ok ? "✓" : "!"} {a.detail}
                </div>
              ))}
            </div>
          </div>
        ))}
        {error && (
          <p className="error" role="alert">
            {error} Review saved actions before retrying.
          </p>
        )}
      </div>
      <form
        className="phase-agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          value={props.playback ? playingPrompt : text}
          maxLength={4000}
          disabled={!props.canNote || busy || !!props.playback}
          placeholder={
            props.canNote ? "Ask Mantel…" : "Agent access is unavailable"
          }
          aria-label="Message Mantel"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          className="send"
          disabled={!props.canNote || !text.trim() || busy || !!props.playback}
          aria-label="Send"
        >
          ↑
        </button>
      </form>
      <p className="phase-agent-foot muted small">
        {props.phase === "model"
          ? "Can edit the MantelCAD design and phase details. Approvals stay with you."
          : "Can edit phase details. Canvas edits and approvals stay with you."}
      </p>
    </aside>
  );
}
