/* The frame every phase shares: the phase bar, the agent panel, the output bar and, outside
   Model (which keeps its own), the top bar. */
import { useState, type ReactNode } from "react";
import { PHASES, phaseStatus, type PhaseId, type PhaseState } from "./phases";
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

export { PhaseAgent } from "./PhaseAgent";

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
