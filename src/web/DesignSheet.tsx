import { assumedCount, sheetRows, type DesignSheet } from "./design-sheet";

/** The model's design sheet, read only: what was asked for, each answer, and the layers. */
export function DesignSheetView(props: { sheet: DesignSheet }) {
  const { sheet } = props;
  const assumed = assumedCount(sheet);
  return (
    <div className="stack design-sheet">
      <blockquote className="design-request">{sheet.request}</blockquote>
      {assumed > 0 && (
        <p className="muted">
          {assumed === 1
            ? "1 answer is an assumption the agent made."
            : `${assumed} answers are assumptions the agent made.`}{" "}
          Confirm or correct them by asking the agent for a change.
        </p>
      )}
      <dl className="design-sections">
        {sheetRows(sheet).map((row) => (
          <div key={row.name} className="design-section">
            <dt>
              {row.name}
              {row.assumed && <span className="assumed-badge">assumed</span>}
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="design-layers-title">
        Layers {sheet.built ? "" : "(framework not built yet)"}
      </h3>
      <ol className="design-layers">
        {sheet.framework.map((layer) => (
          <li key={layer.name}>
            {layer.name} <span className="muted">· {layer.kind}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
