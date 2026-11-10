import { useEffect, useRef, useState } from "react";
import type { ToolbarGroup } from "../shared/toolbar";
import { toolbarGroups } from "./toolbar-groups";

export type ToolbarAction = {
  id: string;
  title: string;
  category: string;
  summary: string;
  /** The tool bar group when it differs from the category. */
  group?: ToolbarGroup;
  featured?: boolean;
};

/**
 * The floating tool bar: each group's featured actions as buttons and a ▾ list of all of them,
 * generated from the catalog and saved actions. On a phone each group is one button.
 */
export function Toolbar(props: {
  actions: ToolbarAction[];
  disabledReason?: string;
  onOpen: () => void;
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState<ToolbarGroup | null>(null);
  const bar = useRef<HTMLElement>(null);
  const onOpen = useRef(props.onOpen);
  onOpen.current = props.onOpen;
  // Saved actions arrive from the server, so they are asked for once on mount, before any menu
  // opens, so the Custom group can show.
  useEffect(() => onOpen.current(), []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const disabled = !!props.disabledReason;
  const choose = (id: string) => {
    setOpen(null);
    props.onChoose(id);
  };
  return (
    <nav
      ref={bar}
      className="cadbar"
      aria-label="Modeling tools"
      title={props.disabledReason}
    >
      {toolbarGroups(props.actions).map((g) => {
        const all = [...g.featured, ...g.more];
        const toggle = () => {
          if (open !== g.group) props.onOpen();
          setOpen(open === g.group ? null : g.group);
        };
        return (
          <div className="cadbar-group" key={g.group}>
            {g.featured.map((a) => (
              <button
                key={a.id}
                className="cadbar-button wide-only"
                disabled={disabled}
                title={props.disabledReason ?? a.summary}
                onClick={() => choose(a.id)}
              >
                {a.title}
              </button>
            ))}
            <button
              className={`cadbar-more ${g.featured.length ? "has-featured" : ""}`}
              disabled={disabled}
              aria-expanded={open === g.group}
              aria-haspopup="menu"
              aria-label={`${g.group} tools`}
              title={props.disabledReason ?? `All ${g.group} tools`}
              onClick={toggle}
            >
              <span className="cadbar-group-name">{g.group}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {open === g.group && (
              <div
                className="popover cadbar-menu"
                role="menu"
                aria-label={`${g.group} tools`}
              >
                {all.map((a) => (
                  <button
                    key={a.id}
                    role="menuitem"
                    className="toolbar-item"
                    title={a.summary}
                    onClick={() => choose(a.id)}
                  >
                    <strong>{a.title}</strong>
                    <span className="muted small">{a.summary}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
