/* Phase 1: the brief, a specification that edits in place. Each field says where its value
   came from and whether it is answered, assumed or still open. */
import { useEffect, useState, type DragEvent } from "react";
import { uploadPhaseFile } from "./api";
import { Banner, OutputBar } from "./PhaseFrame";
import type { PhaseProps } from "./ProjectShell";
import {
  approveBrief,
  briefChanges,
  briefProgress,
  BRIEF_SECTIONS,
  editBriefField,
  type BriefField,
  type BriefFile,
} from "./phases";

const VECTOR = /\.(svg|eps|ai|pdf)$/i;
const LONG = new Set(["story", "lettering", "notes", "fragile", "avoid"]);

export const isVector = (name: string) => VECTOR.test(name);

/** Stores a file in the project's brief and describes it for the brief's file list. */
async function storeFile(
  projectId: string,
  file: File,
  field: string,
): Promise<BriefFile> {
  const stored = await uploadPhaseFile(projectId, "brief", file.name, file);
  return {
    id: stored.id,
    name: file.name,
    type: file.type,
    size: file.size,
    field,
    url: stored.url,
  };
}

export function BriefPhase(props: PhaseProps) {
  const { state, update, readOnly } = props;
  const brief = state.brief;
  const progress = briefProgress(brief);
  const changes = briefChanges(state);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const draft = !brief.approved || brief.version !== brief.approved.version;

  async function attach(files: FileList | File[], field = "logos") {
    let read: BriefFile[];
    try {
      setError("");
      read = await Promise.all(
        [...files].map((f) => storeFile(props.data.project.id, f, field)),
      );
    } catch (e) {
      setError(`Couldn't attach: ${(e as Error).message}`);
      return;
    }
    update((s) => {
      const all = [...s.brief.files, ...read];
      const logos = all.filter((f) => f.field === "logos");
      let next = { ...s, brief: { ...s.brief, files: all } };
      if (field === "logos")
        next = editBriefField(next, "logos", {
          value: logos.map((f) => f.name).join(", "),
          state: logos.some((f) => isVector(f.name)) ? "answered" : "open",
          source: "file",
          note: `${logos.length} ${logos.length === 1 ? "upload" : "uploads"}`,
        });
      return next;
    });
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!readOnly && e.dataTransfer.files.length)
      void attach(e.dataTransfer.files);
  }

  return (
    <div className="brief-wrap">
      <article
        className={`card brief-sheet ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!readOnly) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <h1>Design specification</h1>
        <div className="brief-sub">
          <span className="tag">
            v{brief.version} {draft ? "draft" : "approved"}
          </span>
          {brief.approved && (
            <span>
              v{brief.approved.version} approved by{" "}
              {brief.approved.by === props.email ? "you" : brief.approved.by} ·{" "}
              {new Date(brief.approved.at).toLocaleDateString()}
            </span>
          )}
          {!brief.approved && (
            <span className="muted">
              Shared by the concept, model and document phases once approved.
            </span>
          )}
        </div>
        {changes.length > 0 && (
          <Banner>
            {changes.length} {changes.length === 1 ? "field" : "fields"} changed
            since v{brief.approved!.version}: {changes.join(", ")}. Later phases
            stay on v{brief.approved!.version} until you approve v
            {brief.version}.
          </Banner>
        )}
        {error && !confirming && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {BRIEF_SECTIONS.map(({ section }) => (
          <section className="brief-sec" key={section} id={anchor(section)}>
            <h2>{section}</h2>
            {brief.fields
              .filter((f) => f.section === section)
              .map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  files={brief.files.filter((x) => x.field === f.key)}
                  readOnly={readOnly}
                  onChange={(patch) =>
                    update((s) => editBriefField(s, f.key, patch))
                  }
                  onAttach={(files) => void attach(files, f.key)}
                  onRemoveFile={(id) =>
                    update((s) => {
                      const files = s.brief.files.filter((x) => x.id !== id);
                      const logos = files.filter((x) => x.field === "logos");
                      let next = { ...s, brief: { ...s.brief, files } };
                      if (f.key === "logos")
                        next = editBriefField(next, "logos", {
                          value: logos.map((x) => x.name).join(", "),
                          state: logos.some((x) => isVector(x.name))
                            ? "answered"
                            : "open",
                          source: logos.length ? "file" : "you",
                        });
                      return next;
                    })
                  }
                />
              ))}
          </section>
        ))}
        {!readOnly && (
          <p className="muted small drop-hint">
            Drop a closing memo, brand guide or logo files anywhere on the brief
            to attach them.
          </p>
        )}
      </article>
      <nav className="card brief-index" aria-label="Sections">
        <div className="muted small">Sections</div>
        {BRIEF_SECTIONS.map(({ section }) => {
          const fs = brief.fields.filter((f) => f.section === section);
          const req = fs.filter((f) => f.required);
          const open = req.filter((f) => f.state === "open").length;
          const assumed = fs.filter((f) => f.state === "assumed").length;
          return (
            <a
              key={section}
              href={`#${anchor(section)}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(anchor(section))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {section}
              <span className={`cnt ${open ? "bad" : assumed ? "warn" : ""}`}>
                {req.length ? `${req.length - open}/${req.length}` : ""}
                {assumed ? ` +${assumed}?` : ""}
              </span>
            </a>
          );
        })}
      </nav>

      <OutputBar>
        <span className="output-what">Brief v{brief.version}</span>
        <span className="output-facts">
          <span>
            {progress.answered} of {progress.required} required
          </span>
          {progress.assumed.length > 0 && (
            <span>
              <span className="phase-dot stale" /> {progress.assumed.length}{" "}
              assumed
            </span>
          )}
          {progress.open.length > 0 && (
            <span>
              <span className="phase-dot bad" /> {progress.open.length} open:{" "}
              {progress.open.slice(0, 3).join(", ")}
              {progress.open.length > 3 ? ", …" : ""}
            </span>
          )}
        </span>
        <button
          className="secondary wide-only"
          disabled
          title="Client share links come with the phases' server-side data"
        >
          Share for client review
        </button>
        <button
          disabled={readOnly || progress.open.length > 0 || !draft}
          title={
            progress.open.length
              ? `Still open: ${progress.open.join(", ")}`
              : undefined
          }
          onClick={() => setConfirming(true)}
        >
          {draft ? "Approve brief" : `v${brief.version} approved`}
        </button>
      </OutputBar>

      {confirming && (
        <div className="scrim" role="dialog" aria-modal="true">
          <div className="card confirm">
            <h2>Approve brief v{brief.version}?</h2>
            <p className="muted">
              Concepts, the model and documents will be checked against it.
            </p>
            {progress.assumed.length > 0 && (
              <>
                <p>You are also approving these assumptions:</p>
                <ul>
                  {brief.fields
                    .filter((f) => f.state === "assumed")
                    .map((f) => (
                      <li key={f.key}>
                        <strong>{f.label}:</strong> {f.value}
                      </li>
                    ))}
                </ul>
              </>
            )}
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button
                onClick={() => {
                  try {
                    update((s) =>
                      approveBrief(s, props.email, new Date().toISOString()),
                    );
                    setConfirming(false);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Approve v{brief.version}
              </button>
              <button
                className="secondary"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const anchor = (section: string) =>
  `brief-${section.toLowerCase().replace(/\W+/g, "-")}`;

function FieldRow(props: {
  field: BriefField;
  files: BriefFile[];
  readOnly: boolean;
  onChange: (p: Partial<BriefField>) => void;
  onAttach: (files: FileList) => void;
  onRemoveFile: (id: string) => void;
}) {
  const f = props.field;
  const [value, setValue] = useState(f.value);
  useEffect(() => setValue(f.value), [f.value]);
  // Reads the input itself: a change and a blur in the same tick must not lose the change.
  const commit = (next: string) => {
    if (next !== f.value) props.onChange({ value: next });
  };
  const proposal = f.state === "assumed" || f.source === "agent";
  const raster = props.files.filter((x) => !isVector(x.name));
  const Editor = LONG.has(f.key) ? "textarea" : "input";
  return (
    <div className={`brief-field ${proposal ? "proposal" : ""} ${f.state}`}>
      <label className="brief-k" htmlFor={`f-${f.key}`}>
        {f.label}
        {f.required && <span className="req">*</span>}
      </label>
      <div className="brief-v">
        {f.key === "logos" ? (
          <div className="file-row">
            {props.files.map((x) => (
              <span className="file" key={x.id}>
                {(x.url ?? x.dataUrl) && x.type.startsWith("image/") ? (
                  <img src={x.url ?? x.dataUrl} alt="" />
                ) : (
                  <span className="file-sw">
                    {x.name.split(".").pop()?.toUpperCase()}
                  </span>
                )}
                {x.name}
                <span className={`tag ${isVector(x.name) ? "ok" : "bad"}`}>
                  {isVector(x.name) ? "vector" : "raster"}
                </span>
                {!props.readOnly && (
                  <button
                    className="link"
                    aria-label={`Remove ${x.name}`}
                    onClick={() => props.onRemoveFile(x.id)}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {!props.readOnly && (
              <label className="file add">
                + Attach logo files
                <input
                  type="file"
                  multiple
                  hidden
                  accept=".svg,.eps,.ai,.pdf,image/*"
                  onChange={(e) =>
                    e.target.files && props.onAttach(e.target.files)
                  }
                />
              </label>
            )}
          </div>
        ) : (
          <Editor
            id={`f-${f.key}`}
            className="brief-input"
            value={f.state === "na" ? "" : value}
            placeholder={f.state === "na" ? "Not applicable" : (f.hint ?? "")}
            disabled={props.readOnly || f.state === "na"}
            rows={Editor === "textarea" ? 2 : undefined}
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && Editor === "input")
                (e.target as HTMLInputElement).blur();
            }}
          />
        )}
        {raster.length > 0 && (
          <div className="warnline">
            {raster.map((x) => x.name).join(", ")}{" "}
            {raster.length === 1 ? "is" : "are"} raster. Engraving and printing
            need vector artwork before modeling.
          </div>
        )}
        <span className={`brief-src ${f.source === "agent" ? "agent" : ""}`}>
          {f.state === "open" && !f.value
            ? ""
            : f.source === "agent"
              ? "✦ agent, from the conversation"
              : f.source === "file"
                ? `from file${f.note ? ` · ${f.note}` : ""}`
                : f.state === "assumed"
                  ? "assumed"
                  : "you"}
        </span>
      </div>
      <div className="brief-acts">
        <StateTag state={f.state} />
        {!props.readOnly && proposal && f.value && (
          <button
            className="secondary"
            onClick={() => props.onChange({ state: "answered", source: "you" })}
          >
            ✓ Confirm
          </button>
        )}
        {!props.readOnly && !f.required && (
          <button
            className={f.state === "na" ? "link" : "link hover-only"}
            onClick={() =>
              props.onChange(
                f.state === "na"
                  ? { state: f.value ? "answered" : "open" }
                  : { state: "na" },
              )
            }
          >
            {f.state === "na" ? "Applies" : "N/A"}
          </button>
        )}
        {!props.readOnly && f.value && f.state === "answered" && (
          <button
            className="link hover-only"
            title="Mark as a guess to confirm later"
            onClick={() => props.onChange({ state: "assumed" })}
          >
            Guess
          </button>
        )}
      </div>
    </div>
  );
}

function StateTag({ state }: { state: BriefField["state"] }) {
  const label = state === "na" ? "n/a" : state === "open" ? "open" : state;
  return <span className={`tag ${state}`}>{label}</span>;
}
