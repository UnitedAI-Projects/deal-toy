/* The frame every phase shares: the phase bar, the agent panel, the output bar and, outside
   Model (which keeps its own), the top bar. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { call } from "./api";
import {
  agentGuide,
  PHASES,
  phaseStatus,
  type PhaseId,
  type PhaseState,
} from "./phases";
import type { ThemeChoice } from "./theme";

export function PhaseBar(props: {
  state: PhaseState;
  phase: PhaseId;
  latestRevision: number;
  onChoose: (p: PhaseId) => void;
}) {
  const [open, setOpen] = useState(false);
  const index = PHASES.findIndex((p) => p.id === props.phase);
  const marks = PHASES.map((p) => ({
    ...p,
    status: phaseStatus(props.state, p.id, props.latestRevision),
  }));
  return (
    <>
      <nav className="phasebar" aria-label="Phases">
        {marks.map((p, i) => (
          <button
            key={p.id}
            className={p.id === props.phase ? "on" : ""}
            aria-current={p.id === props.phase ? "step" : undefined}
            onClick={() => props.onChoose(p.id)}
            title={statusLabel(p.status)}
          >
            <span className="phase-n">{i + 1}</span>
            {p.label}
            <PhaseMark status={p.status} />
          </button>
        ))}
      </nav>
      <div className="phasebar-compact">
        <button
          className="chip"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {index + 1} {PHASES[index].label} ▾
        </button>
        {open && (
          <div className="menu" role="menu">
            {marks.map((p, i) => (
              <button
                key={p.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  props.onChoose(p.id);
                }}
              >
                {i + 1} {p.label} <PhaseMark status={p.status} />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function statusLabel(s: string) {
  return s === "approved"
    ? "Approved"
    : s === "stale"
      ? "Needs review: something it was built on changed"
      : s === "active"
        ? "In progress"
        : "Not started";
}

export function PhaseMark({ status }: { status: string }) {
  if (status === "approved")
    return (
      <span className="phase-ok" aria-label="approved">
        ✓
      </span>
    );
  return <span className={`phase-dot ${status}`} aria-hidden="true" />;
}

export function OutputBar(props: { children: ReactNode; pulse?: boolean }) {
  return (
    <div className="output-shell">
      <div className={`output-bar ${props.pulse ? "pulse" : ""}`}>
        {props.children}
      </div>
    </div>
  );
}

export function Banner(props: {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="phase-banner" role="status">
      <span className="phase-dot stale" aria-hidden="true" />
      <span>{props.children}</span>
      {props.action && (
        <button className="secondary" onClick={props.action.onClick}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}

type Sent = { id: number; text: string; status: "sending" | "sent" | string };

export function PhaseAgent(props: {
  phase: PhaseId;
  state: PhaseState;
  latestRevision: number;
  projectId: string;
  canNote: boolean;
  onSuggestion: (text: string) => boolean;
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<Sent[]>([]);
  const [open, setOpen] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const guide = agentGuide(props.state, props.phase, props.latestRevision);
  const label = PHASES.find((p) => p.id === props.phase)!.label;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [sent, props.phase]);
  async function send() {
    const body = text.trim();
    if (!body) return;
    const id = Date.now();
    setSent((s) => [...s, { id, text: body, status: "sending" }]);
    setText("");
    try {
      await call("notes_add", {
        projectId: props.projectId,
        message: `[${label}] ${body}`,
      });
      setSent((s) =>
        s.map((m) => (m.id === id ? { ...m, status: "sent" } : m)),
      );
    } catch (e) {
      setSent((s) =>
        s.map((m) =>
          m.id === id
            ? { ...m, status: `Not sent: ${(e as Error).message}` }
            : m,
        ),
      );
    }
  }
  if (!open)
    return (
      <button className="chip agent-chip" onClick={() => setOpen(true)}>
        <span className="spark">✦</span> Mantel agent
      </button>
    );
  return (
    <aside className="phase-agent" aria-label="Agent">
      <div className="phase-agent-head">
        <strong>
          <span className="spark">✦</span> Mantel agent
        </strong>
        <span className="muted small">In {label}</span>
        <button
          className="link"
          aria-label="Hide the agent"
          onClick={() => setOpen(false)}
        >
          Hide
        </button>
      </div>
      <div className="phase-agent-log" ref={list}>
        <div className="chat-divider">
          <span>{label}</span>
        </div>
        <div className="agent-msg peek">
          <div className="agent-who">Mantel · guide</div>
          {guide.text}
        </div>
        {guide.suggestions.length > 0 && (
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
        {sent.map((m) => (
          <div key={m.id} className="my-msg">
            {m.text}
            <span className="small muted">
              {m.status === "sending"
                ? "Sending…"
                : m.status === "sent"
                  ? "Sent as a note to connected agents"
                  : m.status}
            </span>
          </div>
        ))}
      </div>
      <form
        className="phase-agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          disabled={!props.canNote}
          placeholder={props.canNote ? "Ask Mantel…" : "You can't leave notes"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="send" disabled={!text.trim()} aria-label="Send">
          ↑
        </button>
      </form>
      <p className="phase-agent-foot muted small">
        The built-in agent isn't connected yet. Messages go to connected agents
        as notes on their next tool call.
      </p>
    </aside>
  );
}

export function PhaseTopbar(props: {
  projectName: string;
  demo: boolean;
  phaseBar: ReactNode;
  right?: ReactNode;
  choice: ThemeChoice;
  chooseTheme: (c: ThemeChoice) => void;
  onBack: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="topbar phase-topbar">
      <div className="topbar-left">
        <button
          className="chip brand"
          onClick={props.onBack}
          title="All projects"
        >
          <span className="mark" aria-hidden="true" />
          Mantel
        </button>
        <span className="chip project-name">{props.projectName}</span>
        {props.demo && <span className="chip demo-chip">Demo · view only</span>}
      </div>
      <div className="topbar-center">{props.phaseBar}</div>
      <div className="topbar-right">
        {props.right}
        <button
          className="chip icon"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          ⋯
        </button>
      </div>
      {menu && (
        <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
          {(["system", "light", "dark"] as const).map((c) => (
            <button
              key={c}
              role="menuitemradio"
              aria-checked={props.choice === c}
              onClick={() => props.chooseTheme(c)}
            >
              {props.choice === c ? "✓ " : ""}
              {c === "system"
                ? "Match system"
                : c === "light"
                  ? "Light"
                  : "Dark"}
            </button>
          ))}
          <button role="menuitem" onClick={props.onSettings}>
            Settings
          </button>
          <button role="menuitem" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
