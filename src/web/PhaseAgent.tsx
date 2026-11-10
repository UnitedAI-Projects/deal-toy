import { useEffect, useRef, useState } from "react";
import { request, send } from "./api";
import { agentGuide, PHASES, type PhaseId, type PhaseState } from "./phases";

type Turn = {
  id: string;
  prompt: string;
  response: string;
  status: string;
  actions: { name: string; ok: boolean; detail: string }[];
};
export function PhaseAgent(props: {
  phase: PhaseId;
  state: PhaseState;
  latestRevision: number;
  projectId: string;
  canNote: boolean;
  onSuggestion: (text: string) => boolean;
}) {
  // Remount the conversation when its project/phase changes; in-flight answers cannot leak
  // into the next phase. The server retains the original turn even after navigation.
  return <Conversation key={props.projectId + ":" + props.phase} {...props} />;
}
function Conversation(props: Parameters<typeof PhaseAgent>[0]) {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const generation = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const path = `/api/projects/${props.projectId}/agent`;
  const guide = agentGuide(props.state, props.phase, props.latestRevision);
  const label = PHASES.find((p) => p.id === props.phase)!.label;
  useEffect(() => {
    if (!props.canNote) return;
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
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns]);
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
      { id, prompt: message, response: "", status: "running", actions: [] },
    ]);
    try {
      const result = await send<Turn>(path, "POST", {
        id,
        phase: props.phase,
        message,
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
      className={`phase-agent ${turns.length ? "has-conversation" : ""}`}
      aria-label="Agent"
    >
      <div className="phase-agent-head">
        <strong>Mantel agent</strong>
        <span className="muted small">In {label}</span>
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
        {!turns.length && (
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
        {turns.map((t) => (
          <div key={t.id} className="agent-turn">
            <div className="my-msg">{t.prompt}</div>
            <div className="agent-msg">
              <div className="agent-who">Mantel</div>
              {t.status === "running"
                ? "Working… If interrupted, reload to check saved actions."
                : t.response}
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
          value={text}
          maxLength={4000}
          disabled={!props.canNote || busy}
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
          disabled={!props.canNote || !text.trim() || busy}
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
