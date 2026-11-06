import { useState } from "react";

export type ToolbarAction = {
  id: string;
  title: string;
  category: string;
  summary: string;
};
const ORDER = ["Create", "Modify", "Construct", "Combine", "Arrange", "Custom"];

/** "Add step": the modeling actions by category, generated from the catalog and saved actions. */
export function Toolbar(props: {
  actions: ToolbarAction[];
  disabledReason?: string;
  onOpen: () => void;
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = ORDER.map((category) => ({
    category,
    actions: props.actions.filter((a) => a.category === category),
  })).filter((g) => g.actions.length);
  return (
    <div className="toolbar">
      <button
        className="chip"
        aria-expanded={open}
        disabled={!!props.disabledReason}
        title={props.disabledReason ?? "Add a modeling step"}
        onClick={() => {
          if (!open) props.onOpen();
          setOpen(!open);
        }}
      >
        + Add step
      </button>
      {open && (
        <div
          className="popover toolbar-menu"
          role="menu"
          aria-label="Modeling actions"
        >
          {groups.map((g) => (
            <section key={g.category}>
              <h3>{g.category}</h3>
              {g.actions.map((a) => (
                <button
                  key={a.id}
                  role="menuitem"
                  className="toolbar-item"
                  title={a.summary}
                  onClick={() => {
                    setOpen(false);
                    props.onChoose(a.id);
                  }}
                >
                  <strong>{a.title}</strong>
                  <span className="muted small">{a.summary}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
