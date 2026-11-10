import { useState } from "react";
import type { BrowserFolder } from "./browser-tree";
import { ORIGIN_COLORS, ORIGIN_ITEMS, type OriginItem } from "./origin";

const KEY = "mantel.browser.open";
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const isOrigin = (id: string): id is OriginItem =>
  (ORIGIN_ITEMS as string[]).includes(id);
/** Open by default on a wide screen, closed on a phone; remembered per browser when possible. */
function initialOpen() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // Storage may be unavailable; fall back to the screen size.
  }
  return !window.matchMedia("(max-width: 760px)").matches;
}

/** The Browser card: the origin with show/hide eyes, the bodies, and construction planes. */
export function BrowserPanel(props: {
  tree: BrowserFolder[];
  visible: Record<OriginItem, boolean>;
  onToggle: (item: OriginItem) => void;
  selected: string | null;
  onSelectBody: (label: string, at: { x: number; y: number }) => void;
  onOpenStep: (name: string) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const toggleOpen = () => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? "0" : "1");
    } catch {
      // Not remembered; the card still opens and closes.
    }
  };
  return (
    <section className={`browser ${open ? "open" : ""}`} aria-label="Browser">
      <button
        className="browser-head"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span>Browser</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="browser-body">
          {props.tree.map((f) => (
            <details key={f.folder} open>
              <summary>{f.folder}</summary>
              <ul>
                {f.items.map((item) => {
                  if (f.folder === "Origin" && isOrigin(item.id)) {
                    const id = item.id;
                    const shown = props.visible[id];
                    return (
                      <li key={item.id} className={shown ? "" : "hidden"}>
                        <span
                          className="swatch"
                          style={{ background: hex(ORIGIN_COLORS[id]) }}
                          aria-hidden="true"
                        />
                        <span className="browser-label">
                          {id.length === 2 ? `${id} plane` : `${id} axis`}
                        </span>
                        <button
                          className="eye"
                          aria-pressed={shown}
                          aria-label={`${shown ? "Hide" : "Show"} ${item.label}`}
                          title={shown ? "Hide" : "Show"}
                          onClick={() => props.onToggle(id)}
                        >
                          {shown ? "◉" : "○"}
                        </button>
                      </li>
                    );
                  }
                  const body = f.folder === "Bodies";
                  return (
                    <li key={item.id}>
                      <button
                        className={`browser-item ${body && props.selected === item.label ? "on" : ""}`}
                        title={body ? "Select this body" : "Open this step"}
                        onClick={(e) => {
                          if (!body) return props.onOpenStep(item.id);
                          const r = e.currentTarget.getBoundingClientRect();
                          props.onSelectBody(item.label, {
                            x: r.right,
                            y: r.top + r.height / 2,
                          });
                        }}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
