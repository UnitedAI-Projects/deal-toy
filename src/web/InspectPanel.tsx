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
}) {
  const { record, first, second } = props;
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
              {d.value.toFixed(2)} mm
              {d.param && !d.matches_param && (
                <span className="warn-text"> · differs from {d.param}</span>
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
          ) : (
            <span className="muted small">{between.unavailable}</span>
          )}
        </div>
      )}
      {!second && (
        <p className="muted small">
          Shift-click another face or part to measure between them.
        </p>
      )}
    </div>
  );
}
