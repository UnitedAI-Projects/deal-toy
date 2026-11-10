import { useEffect, useRef, useState } from "react";
import { call, type TrashedProject } from "./api";

/** A dialog that enables its action only once the project's exact name is typed. */
export function ConfirmName(props: {
  title: string;
  body: string;
  name: string;
  action: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onCancel]);
  return (
    <div className="scrim" onClick={props.onCancel}>
      <form
        className="card confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim() !== props.name) return;
          setBusy(true);
          setError("");
          props.onConfirm().catch((err: Error) => {
            setError(err.message);
            setBusy(false);
          });
        }}
      >
        <h2 id="confirm-title">{props.title}</h2>
        <p className="muted">{props.body}</p>
        <label>
          <span>
            Type <strong>{props.name}</strong> to confirm
          </span>
          <input
            ref={input}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && <p className="inline-error">{error}</p>}
        <div className="row">
          <button
            className="danger"
            disabled={busy || typed.trim() !== props.name}
          >
            {props.action}
          </button>
          <button type="button" className="ghost" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString();

/** The owner's trashed projects, each restorable or deletable forever until its time is up. */
export function TrashList(props: { onRestored: () => void }) {
  const [items, setItems] = useState<TrashedProject[] | null>(null);
  const [forever, setForever] = useState<TrashedProject | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    call<{ projects: TrashedProject[] }>("projects_trash")
      .then((r) => setItems(r.projects))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  if (!items?.length && !error) return null;
  return (
    <details className="trash">
      <summary>
        <h2 className="section-title">Trash · {items?.length ?? 0}</h2>
      </summary>
      <p className="muted small">
        Projects here are hidden from everyone. Each is deleted for good on the
        date shown unless you restore it.
      </p>
      {error && <p className="inline-error">{error}</p>}
      <ul className="trash-list">
        {items?.map((p) => (
          <li key={p.id} className="trash-item">
            <div>
              <strong>{p.name}</strong>
              <span className="muted small">
                Deleted {day(p.deleted_at)} · deleted for good{" "}
                {day(p.purge_after)}
              </span>
            </div>
            <div className="row">
              <button
                className="ghost"
                onClick={() =>
                  void call("projects_restore", { projectId: p.id })
                    .then(() => {
                      void load();
                      props.onRestored();
                    })
                    .catch((e: Error) => setError(e.message))
                }
              >
                Restore
              </button>
              <button className="danger" onClick={() => setForever(p)}>
                Delete forever
              </button>
            </div>
          </li>
        ))}
      </ul>
      {forever && (
        <ConfirmName
          title={`Delete ${forever.name} forever?`}
          body="Its models, revisions, builds, files, documents and activity are removed now. This cannot be undone."
          name={forever.name}
          action="Delete forever"
          onCancel={() => setForever(null)}
          onConfirm={async () => {
            await call("projects_purge", {
              projectId: forever.id,
              name: forever.name,
            });
            setForever(null);
            await load();
          }}
        />
      )}
    </details>
  );
}
