import { useState } from "react";
import type { Target } from "../shared/checks";
import type { DimensionRecord } from "../shared/inspect-types";
import { refText } from "./ActionForm";
import { refFromPick } from "./refs";
import {
  faceSummary,
  measureBetween,
  type InspectRecord,
  type Selection,
} from "./inspect";

export type Picked = { label: string; x: number; y: number; face?: number };

const asSelection = (record: InspectRecord, p: Picked): Selection =>
  p.face !== undefined
    ? { kind: "face", index: p.face }
    : {
        kind: "part",
        index: Math.max(
          0,
          record.parts.findIndex((x) => x.label === p.label),
        ),
      };

function partRows(record: InspectRecord, label: string): [string, string][] {
  const part = record.parts.find((p) => p.label === label);
  if (!part) return [];
  const material = record.materials?.[label];
  const rows: [string, string][] = [
    ["Volume", `${part.volume.toFixed(2)} mm³`],
    ["Surface area", `${part.area.toFixed(2)} mm²`],
    [
      "Centre of mass",
      `(${part.center_of_mass.map((v) => v.toFixed(2)).join(", ")}) mm`,
    ],
  ];
  if (material)
    rows.push(
      ["Material", material.name],
      [
        "Mass",
        `${((part.volume / 1000) * material.density_g_cm3).toFixed(2)} g`,
      ],
    );
  const embed = record.embeds?.find(
    (e) => record.parts[e.part]?.label === label,
  );
  if (embed)
    rows.push([
      "Embedded in",
      `${record.parts[embed.in]?.label} · wall ${embed.wall.toFixed(2)} mm${embed.contained ? "" : " · not fully contained"}`,
    ]);
  return rows;
}

/** Exact measurements for the picked face or part, and between two picks. */
export function InspectPanel(props: {
  record: InspectRecord;
  first: Picked;
  second: Picked | null;
  onShowPart: () => void;
  onClose: () => void;
  /** Runs an exact measure job between the two picks; absent when the member cannot build. */
  onMeasure?: (a: Target, b: Target) => Promise<string>;
  /** Sends the agent a note about the selection; absent for viewers. */
  onAsk?: (text: string, refs: string) => Promise<void>;
  /** Saves a new value for a declared dimension (one parameter edit); absent when read-only. */
  onAdjust?: (dim: DimensionRecord, value: number) => Promise<void>;
}) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const { record, first, second } = props;
  const [exact, setExact] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const target = (p: Picked): Target => {
    const s = asSelection(record, p);
    return s.kind === "face" ? { face: s.index } : { part: s.index };
  };
  const refs = [first, second]
    .filter((p): p is Picked => !!p)
    .map((p) =>
      p.face !== undefined
        ? refText(refFromPick(record, p.face))
        : `part("${p.label}")`,
    )
    .join(" · ");
  const summary =
    first.face !== undefined
      ? faceSummary(record, first.face)
      : { title: first.label, rows: partRows(record, first.label) };
  const between = second
    ? measureBetween(
        record,
        asSelection(record, first),
        asSelection(record, second),
      )
    : null;
  const dims = (record.dimensions ?? []).filter(
    (d) => first.face !== undefined && d.faces.includes(first.face),
  );
  const style = {
    left: `min(max(12px, ${first.x + 16}px), calc(100% - 308px))`,
    top: `min(max(64px, ${first.y - 40}px), calc(100% - 320px))`,
  };
  return (
    <div
      className="popover inspect-panel"
      style={style}
      role="dialog"
      aria-label={summary.title}
    >
      <div className="popover-head">
        <strong>{summary.title}</strong>
        <button
          className="icon ghost"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <nav className="crumbs" aria-label="Selection level">
        {first.face !== undefined && <span className="on">Face</span>}
        <button className="link" onClick={props.onShowPart}>
          Part: {first.label}
        </button>
      </nav>
      <dl className="measures">
        {summary.rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {dims.map((d) => (
          <div key={d.name}>
            <dt>{d.name}</dt>
            <dd>
              {props.onAdjust && d.param && d.matches_param ? (
                <form
                  className="dim-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = Number(typed[d.name] ?? d.value);
                    setStatus("Saving a new revision…");
                    props.onAdjust!(d, value)
                      .then(() => setStatus("Saved; rebuilding."))
                      .catch((err: Error) => setStatus(err.message));
                  }}
                >
                  <input
                    type="number"
                    step="0.1"
                    aria-label={`${d.name} (mm)`}
                    value={typed[d.name] ?? d.value.toString()}
                    onChange={(e) =>
                      setTyped({ ...typed, [d.name]: e.target.value })
                    }
                  />{" "}
                  mm{" "}
                  <button
                    type="submit"
                    disabled={
                      typed[d.name] === undefined ||
                      Number(typed[d.name]) === d.value
                    }
                  >
                    Save
                  </button>
                </form>
              ) : (
                <>
                  {d.value.toFixed(2)} mm
                  {d.param && !d.matches_param && (
                    <span className="warn-text">
                      {" "}
                      · differs from {d.param}; ask the agent to fix the
                      declaration
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {between && (
        <div className="between">
          <span className="muted small">{between.label}</span>
          {"value" in between ? (
            <strong>{between.value}</strong>
          ) : exact ? (
            <strong>{exact}</strong>
          ) : (
            <span className="muted small">{between.unavailable}</span>
          )}
          {!("value" in between) &&
            !exact &&
            props.onMeasure &&
            between.unavailable === "Needs an exact measure" && (
              <button
                className="link small"
                disabled={status === "Measuring…"}
                onClick={() => {
                  setStatus("Measuring…");
                  props.onMeasure!(target(first), target(second!))
                    .then((v) => {
                      setExact(v);
                      setStatus("");
                    })
                    .catch((e: Error) => setStatus(e.message));
                }}
              >
                Measure exactly
              </button>
            )}
        </div>
      )}
      {!second && (
        <p className="muted small">
          Shift-click another face or part to measure between them.
        </p>
      )}
      {status && <p className="muted small">{status}</p>}
      {props.onAsk &&
        (asking === null ? (
          <button className="link small" onClick={() => setAsking("")}>
            Ask the agent…
          </button>
        ) : (
          <form
            className="ask-agent"
            onSubmit={(e) => {
              e.preventDefault();
              props.onAsk!(asking.trim(), refs)
                .then(() => {
                  setAsking(null);
                  setStatus("Sent to the agent as a team note.");
                })
                .catch((err: Error) => setStatus(err.message));
            }}
          >
            <textarea
              aria-label="Ask the agent"
              placeholder="Make this wall 2 mm thicker…"
              value={asking}
              maxLength={3500}
              onChange={(e) => setAsking(e.target.value)}
            />
            <p className="faint small">Includes: {refs}</p>
            <div className="row">
              <button type="submit" disabled={!asking.trim()}>
                Send
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setAsking(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ))}
    </div>
  );
}
