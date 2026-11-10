/* Phase 2: a board of rough, disposable concepts. Choosing one records the approved visual
   qualities, targets (not dimensions) and the questions still open. */
import { useEffect, useRef, useState } from "react";
import { Banner, OutputBar } from "./PhaseFrame";
import type { PhaseProps } from "./ProjectShell";
import {
  approvedBriefVersion,
  conceptWarnings,
  phaseStatus,
  type Concept,
  type ConceptDecision,
  type Question,
} from "./phases";

const MAX_IMAGE = 1.5 * 1024 * 1024;
const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function blank(name: string, image?: string): Concept {
  return {
    id: newId(),
    name,
    size: "",
    materials: "",
    components: "",
    notes: "",
    image,
    starred: false,
    discarded: false,
    createdAt: new Date().toISOString(),
  };
}

export function ConceptsPhase(props: PhaseProps) {
  const { state, update, readOnly } = props;
  const live = state.concepts.filter((c) => !c.discarded);
  const tray = state.concepts.filter((c) => c.discarded);
  const [selected, setSelected] = useState<string | null>(
    state.decision?.conceptId ?? live[0]?.id ?? null,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [sketch, setSketch] = useState<{ conceptId?: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState("");
  const status = phaseStatus(state, "concepts", props.latestRevision);
  const chosen = state.concepts.find((c) => c.id === state.decision?.conceptId);
  const current = state.concepts.find((c) => c.id === selected) ?? null;
  const letter = (i: number) => String.fromCharCode(65 + (i % 26));

  const patch = (id: string, p: Partial<Concept>) =>
    update((s) => ({
      ...s,
      concepts: s.concepts.map((c) => (c.id === id ? { ...c, ...p } : c)),
    }));
  const add = (c: Concept) => {
    update((s) => ({ ...s, concepts: [...s.concepts, c] }));
    setSelected(c.id);
    setEditing(c.id);
  };
  function reference(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE) {
      setError(`${file.name} is over 1.5 MB. Use a smaller image.`);
      return;
    }
    const r = new FileReader();
    r.onload = () =>
      add(blank(file.name.replace(/\.\w+$/, ""), String(r.result)));
    r.readAsDataURL(file);
  }
  const shown = compare ? live.filter((c) => c.starred) : live;

  return (
    <div className="concepts">
      {!state.brief.approved && (
        <Banner
          action={{ label: "Go to Brief", onClick: () => props.go("brief") }}
        >
          The brief isn't approved yet. Concepts are checked against the draft.
        </Banner>
      )}
      {status === "stale" && (
        <Banner
          action={{ label: "Choose again", onClick: () => setChoosing(true) }}
        >
          You chose {chosen?.name ?? "a concept"} on brief v
          {state.decision!.briefVersion}; brief v{approvedBriefVersion(state)}{" "}
          is now approved.
        </Banner>
      )}
      <div className="board-tools">
        <div className="cadbar static" role="toolbar" aria-label="Concepts">
          <button
            className="cadbar-button"
            disabled={readOnly}
            onClick={() =>
              add(blank(`Concept ${letter(state.concepts.length)}`))
            }
          >
            + New concept
          </button>
          <button
            className="cadbar-button"
            disabled={readOnly}
            onClick={() => setSketch({})}
          >
            ✎ Sketch
          </button>
          <label className={`cadbar-button ${readOnly ? "disabled" : ""}`}>
            ⤒ Reference
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={readOnly}
              onChange={(e) => {
                reference(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <span className="cadbar-sep" />
          <button
            className="cadbar-button"
            disabled
            title="Concept generation isn't connected yet"
          >
            ✦ Generate
          </button>
          <button
            className={`cadbar-button ${compare ? "active" : ""}`}
            disabled={!live.some((c) => c.starred)}
            onClick={() => setCompare(!compare)}
          >
            {compare ? "Show all" : "Compare starred"}
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button className="link" onClick={() => setError("")}>
            Dismiss
          </button>
        </p>
      )}

      {!live.length ? (
        <div className="concepts-empty">
          <h2>Rough ideas go here</h2>
          <p className="muted">
            Add a concept from a description, a quick sketch or a reference
            photo. Nothing on this board is permanent: discard freely, and
            choose one when the shape, proportions and materials feel right.
          </p>
        </div>
      ) : (
        <div className={`board ${compare ? "compare" : ""}`}>
          {shown.map((c) => {
            const warns = conceptWarnings(c, state);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                className={`concept ${c.id === selected ? "sel" : ""} ${c.id === state.decision?.conceptId ? "chosen" : ""}`}
                onClick={() => setSelected(c.id)}
                onDoubleClick={() => setEditing(c.id)}
                onKeyDown={(e) => e.key === "Enter" && setEditing(c.id)}
              >
                <span className="concept-tag">
                  {c.id === state.decision?.conceptId ? "Chosen" : "Concept"}
                </span>
                <button
                  className={`concept-star ${c.starred ? "on" : ""}`}
                  aria-label={c.starred ? "Unstar" : "Star"}
                  aria-pressed={c.starred}
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation();
                    patch(c.id, { starred: !c.starred });
                  }}
                >
                  {c.starred ? "★" : "☆"}
                </button>
                <div className="concept-pv">
                  {c.image ? (
                    <img src={c.image} alt="" />
                  ) : (
                    <span className="concept-blank">{c.name.slice(0, 1)}</span>
                  )}
                </div>
                <div className="concept-nm">{c.name}</div>
                <div className="concept-meta">
                  {c.size
                    ? `≈ ${c.size.replace(/^≈\s*/, "")}`
                    : "No rough size yet"}
                  {c.components &&
                    ` · ${c.components.split(",").filter((x) => x.trim()).length} parts`}
                </div>
                {c.materials && (
                  <div className="concept-meta">{c.materials}</div>
                )}
                {warns.map((w) => (
                  <div key={w} className="warnline">
                    ⚠ {w}
                  </div>
                ))}
                <div className="concept-acts">
                  <button
                    className="link"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(c.id);
                    }}
                  >
                    Open
                  </button>
                  {!readOnly && (
                    <button
                      className="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        patch(c.id, { discarded: true, starred: false });
                        if (selected === c.id) setSelected(null);
                      }}
                    >
                      Discard
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tray.length > 0 && (
        <details className="tray">
          <summary>
            {tray.length} discarded {tray.length === 1 ? "concept" : "concepts"}
            , kept in the tray
          </summary>
          <div className="row">
            {tray.map((c) => (
              <span key={c.id} className="chip">
                {c.name}
                {!readOnly && (
                  <button
                    className="link"
                    onClick={() => patch(c.id, { discarded: false })}
                  >
                    Restore
                  </button>
                )}
              </span>
            ))}
          </div>
        </details>
      )}

      <OutputBar>
        <span className="output-what">Concepts</span>
        <span className="output-facts">
          <span>
            {live.length} {live.length === 1 ? "concept" : "concepts"}
          </span>
          <span>{live.filter((c) => c.starred).length} starred</span>
          {chosen && status !== "stale" && (
            <span>
              <span className="phase-ok">✓</span> {chosen.name} chosen
            </span>
          )}
        </span>
        <button
          disabled={readOnly || !current || current.discarded}
          onClick={() => setChoosing(true)}
        >
          {current ? `Choose ${current.name}…` : "Select a concept"}
        </button>
      </OutputBar>

      {editing && (
        <ConceptEditor
          concept={state.concepts.find((c) => c.id === editing)!}
          warnings={conceptWarnings(
            state.concepts.find((c) => c.id === editing)!,
            state,
          )}
          readOnly={readOnly}
          onPatch={(p) => patch(editing, p)}
          onSketch={() => setSketch({ conceptId: editing })}
          onClose={() => setEditing(null)}
        />
      )}
      {sketch && (
        <SketchPad
          onCancel={() => setSketch(null)}
          onSave={(png) => {
            if (sketch.conceptId) patch(sketch.conceptId, { image: png });
            else add(blank(`Sketch ${letter(state.concepts.length)}`, png));
            setSketch(null);
          }}
        />
      )}
      {choosing && current && (
        <DecisionSheet
          concept={current}
          previous={
            state.decision?.conceptId === current.id
              ? state.decision
              : undefined
          }
          warnings={conceptWarnings(current, state)}
          onUpdateBrief={() => {
            setChoosing(false);
            props.go("brief");
          }}
          onCancel={() => setChoosing(false)}
          onChoose={(d) => {
            update((s) => ({
              ...s,
              decision: {
                ...d,
                conceptId: current.id,
                briefVersion: approvedBriefVersion(s),
                by: props.email,
                at: new Date().toISOString(),
              },
            }));
            setChoosing(false);
          }}
        />
      )}
    </div>
  );
}

function ConceptEditor(props: {
  concept: Concept;
  warnings: string[];
  readOnly: boolean;
  onPatch: (p: Partial<Concept>) => void;
  onSketch: () => void;
  onClose: () => void;
}) {
  const c = props.concept;
  const field = (
    key: "name" | "size" | "materials" | "components" | "notes",
    label: string,
    hint: string,
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={c[key]}
        placeholder={hint}
        disabled={props.readOnly}
        onChange={(e) => props.onPatch({ [key]: e.target.value })}
      />
    </label>
  );
  return (
    <aside className="card side-sheet" aria-label={`Concept ${c.name}`}>
      <div className="side-sheet-head">
        <strong>{c.name}</strong>
        <span className="tag">Concept · rough</span>
        <button className="link" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="side-sheet-body">
        <div className="concept-pv large">
          {c.image ? (
            <img src={c.image} alt="" />
          ) : (
            <span className="concept-blank">{c.name.slice(0, 1)}</span>
          )}
        </div>
        {!props.readOnly && (
          <button className="secondary" onClick={props.onSketch}>
            {c.image ? "Sketch over a new image" : "Sketch it"}
          </button>
        )}
        {field("name", "Name", "Single tower, cable fan")}
        {field("size", "Rough size", "210 × 84 × 196 mm")}
        {field("materials", "Materials and finish", "Satin nickel on walnut")}
        {field("components", "Components", "Tower, deck, cables, base")}
        {field("notes", "Notes", "What makes it work")}
        {props.warnings.map((w) => (
          <div className="warnline" key={w}>
            ⚠ {w}
          </div>
        ))}
        <p className="muted small">
          Everything here is a rough target. Exact dimensions are set in Model.
        </p>
      </div>
    </aside>
  );
}

function SketchPad(props: {
  onSave: (png: string) => void;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 640, 420);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#1b1c20";
  }, []);
  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * 640,
      ((e.clientY - r.top) / r.height) * 420,
    ];
  };
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Sketch">
      <div className="card sketch-pad">
        <div className="side-sheet-head">
          <strong>Sketch a concept</strong>
          <span className="muted small">Rough is fine</span>
        </div>
        <canvas
          ref={canvas}
          width={640}
          height={420}
          onPointerDown={(e) => {
            drawing.current = true;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            const ctx = canvas.current!.getContext("2d")!;
            const [x, y] = at(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext("2d")!;
            const [x, y] = at(e);
            ctx.lineTo(x, y);
            ctx.stroke();
            setEmpty(false);
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        <div className="row">
          <button
            disabled={empty}
            onClick={() => props.onSave(canvas.current!.toDataURL("image/png"))}
          >
            Save sketch
          </button>
          <button
            className="secondary"
            onClick={() => {
              const ctx = canvas.current!.getContext("2d")!;
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, 640, 420);
              setEmpty(true);
            }}
          >
            Clear
          </button>
          <button className="secondary" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type Draft = Pick<ConceptDecision, "qualities" | "targets" | "questions">;

function DecisionSheet(props: {
  concept: Concept;
  previous?: ConceptDecision;
  warnings: string[];
  onChoose: (d: Draft) => void;
  onUpdateBrief: () => void;
  onCancel: () => void;
}) {
  const c = props.concept;
  const [d, setD] = useState<Draft>(
    () =>
      props.previous ?? {
        qualities: [
          { label: "Silhouette", value: c.name, approved: true },
          { label: "Proportions", value: c.size || "—", approved: !!c.size },
          {
            label: "Material and finish",
            value: c.materials || "—",
            approved: !!c.materials,
          },
          {
            label: "Components",
            value: c.components || "—",
            approved: !!c.components,
          },
        ],
        targets: c.size,
        questions: [],
      },
  );
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState<Question["owner"]>("model");
  const [kept, setKept] = useState(false);
  return (
    <aside className="card side-sheet" aria-label={`Choose ${c.name}`}>
      <div className="side-sheet-head">
        <strong>Choose {c.name}</strong>
        <button className="link" onClick={props.onCancel} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="side-sheet-body">
        <h3>Approved visual qualities</h3>
        {d.qualities.map((x, i) => (
          <label key={x.label} className="tick-row">
            <input
              type="checkbox"
              checked={x.approved}
              onChange={(e) =>
                setD({
                  ...d,
                  qualities: d.qualities.map((y, j) =>
                    j === i ? { ...y, approved: e.target.checked } : y,
                  ),
                })
              }
            />
            <span>
              <strong>{x.label}:</strong> {x.value}
            </span>
          </label>
        ))}
        <h3>Targets for the model (not dimensions)</h3>
        <input
          value={d.targets}
          placeholder="≈ 210 × 84 × 196 mm"
          onChange={(e) => setD({ ...d, targets: e.target.value })}
        />
        <h3>Open questions</h3>
        {d.questions.map((x) => (
          <div key={x.id} className="question">
            <span>{x.text}</span>
            <span className="tag">{x.owner}</span>
            <button
              className="link"
              aria-label="Remove"
              onClick={() =>
                setD({
                  ...d,
                  questions: d.questions.filter((y) => y.id !== x.id),
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
        <form
          className="question-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            setD({
              ...d,
              questions: [
                ...d.questions,
                { id: newId(), text: q.trim(), owner },
              ],
            });
            setQ("");
          }}
        >
          <input
            value={q}
            placeholder="Can the cables be 0.8 mm wire?"
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            value={owner}
            aria-label="Who answers it"
            onChange={(e) => setOwner(e.target.value as Question["owner"])}
          >
            <option value="client">client</option>
            <option value="maker">maker</option>
            <option value="model">model</option>
          </select>
          <button className="secondary">Add</button>
        </form>
        {props.warnings.length > 0 && !kept && (
          <div className="callout">
            {props.warnings.join(". ")}. Update the brief, or keep it and adjust
            in the model?
            <div className="row">
              <button className="secondary" onClick={props.onUpdateBrief}>
                Update brief
              </button>
              <button className="link" onClick={() => setKept(true)}>
                Keep brief
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="side-sheet-foot">
        <button className="secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button onClick={() => props.onChoose(d)}>Choose concept</button>
      </div>
    </aside>
  );
}
