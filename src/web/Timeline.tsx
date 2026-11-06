import { useState } from "react";
import { call, type StepLog } from "./api";
import { moveAfter } from "./reorder";
import { timelineChips } from "./timeline-chips";

/** The model's steps in build order, with each step's health. Owners can turn a step off or on. */
export function Timeline(props: {
  modelId: string;
  revision: number;
  steps: StepLog[];
  incomplete: boolean;
  building: boolean;
  editable: boolean;
  onChanged: () => void;
  /** Show the model as it was after this step. */
  onViewAsOf?: (step: string) => void;
  /** Open this step's form to change its inputs. */
  onEdit?: (step: string) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chips = timelineChips(props.steps, props.building);
  const chip = chips.find((c) => c.name === open);
  async function change(tool: string, input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await call(tool, {
        modelId: props.modelId,
        expectedRevision: props.revision,
        ...input,
      });
      setOpen(null);
      setRenaming(null);
      setRemoving(false);
      props.onChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Change was not saved";
      if (message.startsWith("Model changed")) {
        setError("Someone changed the model; reloading");
        props.onChanged();
      } else setError(message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(name: string, suppressed: boolean) {
    setBusy(true);
    setError("");
    try {
      await call("steps_suppress", {
        modelId: props.modelId,
        expectedRevision: props.revision,
        name,
        suppressed,
      });
      setOpen(null);
      props.onChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Change was not saved";
      if (message.startsWith("Model changed")) {
        setError("Someone changed the model; reloading");
        props.onChanged();
      } else setError(message);
    } finally {
      setBusy(false);
    }
  }
  const original = props.steps.find((s) => s.name === open);
  return (
    <section className="timeline" aria-label="Steps">
      {props.incomplete && !props.building && (
        <span className="timeline-badge">Incomplete build</span>
      )}
      <ol>
        {chips.map((c, i) => (
          <li key={c.name}>
            <button
              draggable={props.editable && !props.building}
              onDragStart={(e) => {
                setDragged(c.name);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => dragged && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const after = dragged
                  ? moveAfter(
                      props.steps.map((x) => x.name),
                      dragged,
                      c.name,
                    )
                  : undefined;
                if (dragged && after !== undefined)
                  void change("steps_move", { name: dragged, after });
                setDragged(null);
              }}
              onDragEnd={() => setDragged(null)}
              className={`step-chip ${c.tone} ${open === c.name ? "on" : ""} ${dragged === c.name ? "dragging" : ""}`}
              aria-expanded={open === c.name}
              title={`${c.title}: ${c.state}`}
              onClick={() => setOpen(open === c.name ? null : c.name)}
            >
              <span className="step-dot" aria-hidden="true" />
              <span className="step-index">{i + 1}</span>
              {c.name}
            </button>
          </li>
        ))}
      </ol>
      {chip && original && (
        <div
          className="popover step-popover"
          role="dialog"
          aria-label={chip.name}
        >
          <div className="popover-head">
            <strong>{chip.name}</strong>
            <button
              className="icon ghost"
              aria-label="Close"
              onClick={() => setOpen(null)}
            >
              ×
            </button>
          </div>
          <p className="muted small">
            {chip.title} · {chip.state}
          </p>
          <p className="small">{chip.meaning}</p>
          {chip.detail && <p className="small step-detail">{chip.detail}</p>}
          {error && (
            <p className="inline-error small" role="alert">
              {error}
            </p>
          )}
          {props.onViewAsOf && !props.building && (
            <button
              className="secondary"
              onClick={() => {
                props.onViewAsOf?.(chip.name);
                setOpen(null);
              }}
            >
              View as of this step
            </button>
          )}
          {props.editable && !props.building && (
            <div className="row step-actions">
              {props.onEdit && (
                <button
                  className="secondary"
                  onClick={() => props.onEdit?.(chip.name)}
                >
                  Edit
                </button>
              )}
              {renaming === null ? (
                <button
                  className="secondary"
                  onClick={() => setRenaming(chip.name)}
                >
                  Rename
                </button>
              ) : (
                <span className="preset-save">
                  <input
                    aria-label="New step name"
                    value={renaming}
                    maxLength={80}
                    onChange={(e) => setRenaming(e.target.value)}
                  />
                  <button
                    className="secondary"
                    disabled={
                      busy || !renaming.trim() || renaming === chip.name
                    }
                    onClick={() =>
                      void change("steps_rename", {
                        name: chip.name,
                        newName: renaming.trim(),
                      })
                    }
                  >
                    Save
                  </button>
                </span>
              )}
              <button
                className="secondary danger"
                disabled={busy}
                onClick={() =>
                  removing
                    ? void change("steps_remove", { name: chip.name })
                    : setRemoving(true)
                }
              >
                {removing ? "Confirm remove" : "Remove"}
              </button>
            </div>
          )}
          {props.editable && !props.building && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => toggle(chip.name, original.state !== "suppressed")}
            >
              {original.state === "suppressed"
                ? "Turn step on"
                : "Turn step off"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
