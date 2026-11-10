import { useEffect, useRef, useState } from "react";
import type { ToolbarAction } from "./Toolbar";
import { searchActions } from "./toolbar-groups";

/** The search chip: type to find any action by name, id or summary, then Enter to open it. */
export function CommandSearch(props: {
  actions: ToolbarAction[];
  disabledReason?: string;
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const results = searchActions(props.actions, query).slice(0, 8);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    setQuery("");
    setIndex(0);
  };
  const choose = (id: string) => {
    close();
    props.onChoose(id);
  };
  return (
    <div className="command-search" ref={box}>
      <button
        className="chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!!props.disabledReason}
        title={props.disabledReason ?? "Search tools"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden="true">⌕</span>
        <span className="wide-only">Search</span>
      </button>
      {open && (
        <div
          className="popover command-results"
          role="dialog"
          aria-label="Search tools"
        >
          <input
            autoFocus
            type="search"
            placeholder="Find a tool…"
            aria-label="Find a tool"
            aria-controls="command-list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown")
                setIndex((i) => Math.min(i + 1, results.length - 1));
              else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
              else if (e.key === "Enter" && results[index])
                choose(results[index].id);
              else return;
              e.preventDefault();
            }}
          />
          {query.trim() && (
            <ul id="command-list" role="listbox" className="command-list">
              {results.map((a, i) => (
                <li key={a.id} role="option" aria-selected={i === index}>
                  <button
                    className={`toolbar-item ${i === index ? "active" : ""}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(a.id)}
                  >
                    <strong>{a.title}</strong>
                    <span className="muted small">{a.summary}</span>
                  </button>
                </li>
              ))}
              {!results.length && (
                <li className="muted small">No tool matches “{query}”.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
