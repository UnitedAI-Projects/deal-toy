import { useEffect, useState } from "react";
import type { Check, CheckLimit, CheckResult } from "../shared/checks";
import type { InspectRecord } from "../shared/inspect-types";
import { call } from "./api";
import {
  checkFromSelection,
  limitText,
  resultText,
  type CheckDraft,
  type Pick,
  type Toggles,
} from "./checks";

type Preset = {
  id: string;
  name: string;
  description: string;
  checks: CheckDraft[];
};
type List = { version: number; checks: Check[]; presets: Preset[] };
export type Results = {
  revision: number;
  buildId: string | null;
  results: CheckResult[];
  previous: Record<
    string,
    { revision: number; status: string; value?: number }
  >;
};

const STALE = "Checks changed. Reload before saving.";

/** Which limit fields a check kind takes, in the order they are edited. */
function limitFields(
  kind: Check["kind"],
): (keyof CheckLimit | "x" | "y" | "z")[] {
  switch (kind) {
    case "no_overlap":
      return [];
    case "dimension":
      return ["nominal", "tolerance"];
    case "hole":
      return ["min", "max"];
    case "envelope":
      return ["x", "y", "z"];
    default:
      return ["min"];
  }
}

function LimitEditor(props: {
  check: Check;
  onSave: (limit: CheckLimit) => void;
  onCancel: () => void;
}) {
  const { check } = props;
  const size = check.limit.size ?? [null, null, null];
  const initial: Record<string, string> = {
    min: check.limit.min?.toString() ?? "",
    max: check.limit.max?.toString() ?? "",
    nominal: check.limit.nominal?.toString() ?? "",
    tolerance: check.limit.tolerance?.toString() ?? "",
    x: size[0]?.toString() ?? "",
    y: size[1]?.toString() ?? "",
    z: size[2]?.toString() ?? "",
  };
  const [values, setValues] = useState(initial);
  const n = (k: string) => (values[k] === "" ? null : Number(values[k]));
  const unit =
    check.kind === "stability" || check.kind === "draft" ? "°" : "mm";
  return (
    <form
      className="limit-editor"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave(
          check.kind === "envelope"
            ? {
                size: [n("x"), n("y"), n("z")].every((v) => v !== null)
                  ? ([n("x"), n("y"), n("z")] as [number, number, number])
                  : null,
              }
            : Object.fromEntries(limitFields(check.kind).map((k) => [k, n(k)])),
        );
      }}
    >
      {limitFields(check.kind).map((k) => (
        <label key={k}>
          <span className="muted small">{k}</span>
          <input
            type="number"
            step="any"
            aria-label={`${check.name} ${k}`}
            value={values[k]}
            onChange={(e) => setValues({ ...values, [k]: e.target.value })}
          />
        </label>
      ))}
      <span className="muted small">{unit}</span>
      <button type="submit">Save</button>
      <button type="button" className="secondary" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

/**
 * The model's saved checks with their result on the shown build. People and agents edit the same
 * list; demo viewers see it read-only.
 */
export function ChecksPanel(props: {
  modelId: string;
  revision: number;
  record: InspectRecord | null;
  picks: Pick[];
  canEdit: boolean;
  canMeasure: boolean;
  refresh: unknown;
  toggles: Toggles;
  onToggles: (t: Toggles) => void;
  onResults: (checks: Check[], results: CheckResult[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<List | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [l, r] = await Promise.all([
      call<List>("checks_list", { modelId: props.modelId }),
      call<Results>("checks_results", {
        modelId: props.modelId,
        revision: props.revision,
      }),
    ]);
    setList(l);
    setResults(r);
    props.onResults(l.checks, r.results);
  }
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [props.modelId, props.revision, props.refresh]);

  async function save(checks: (Check | (CheckDraft & { enabled: boolean }))[]) {
    if (!list) return;
    setBusy(true);
    setError("");
    try {
      await call("checks_save", {
        modelId: props.modelId,
        expectedVersion: list.version,
        checks: checks.map((c) => ({
          ...("id" in c ? { id: c.id } : {}),
          name: c.name,
          kind: c.kind,
          enabled: c.enabled,
          target: c.target,
          limit: c.limit,
          ...("exceptions" in c && c.exceptions
            ? { exceptions: c.exceptions }
            : {}),
        })),
      });
      setEditing(null);
    } catch (e) {
      const message = (e as Error).message;
      setError(
        message === STALE
          ? "Someone else changed the checks. This is the latest list."
          : message,
      );
    } finally {
      await load().catch(() => {});
      setBusy(false);
    }
  }
  async function measure(r: CheckResult) {
    if (!results?.buildId || !r.measure) return;
    setError("");
    try {
      await call("inspect_measure", {
        buildId: results.buildId,
        a: r.measure.a,
        b: r.measure.b,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const checks = list?.checks ?? [];
  const byId = new Map(results?.results.map((r) => [r.id, r]) ?? []);
  const suggestions = props.record
    ? checkFromSelection(props.record, props.picks)
    : [];
  const counts = (s: CheckResult["status"]) =>
    results?.results.filter((r) => r.status === s && r.reason !== "Turned off")
      .length ?? 0;
  return (
    <aside className="popover checks-panel" role="dialog" aria-label="Checks">
      <div className="popover-head">
        <strong>Checks</strong>
        <button
          className="icon ghost"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <p className="muted small">
        Revision {results?.revision ?? props.revision} · {counts("pass")} pass ·{" "}
        {counts("fail")} fail · {counts("unknown")} unknown. A passing list is
        not manufacturing approval.
      </p>
      <div
        className="row tone-toggles"
        role="group"
        aria-label="Colour on the model"
      >
        {(["overlap", "clearance", "draft"] as const).map((k) => (
          <label key={k} className="small">
            <input
              type="checkbox"
              checked={props.toggles[k]}
              onChange={(e) =>
                props.onToggles({ ...props.toggles, [k]: e.target.checked })
              }
            />{" "}
            {k === "overlap"
              ? "Overlap"
              : k === "clearance"
                ? "Clearance"
                : "Draft"}
          </label>
        ))}
      </div>
      {error && (
        <p className="inline-error small" role="alert">
          {error}
        </p>
      )}
      {!checks.length && list && (
        <p className="muted small">
          No checks yet.{" "}
          {props.canEdit
            ? "Pick a face or part and add one, or start from a preset."
            : ""}
        </p>
      )}
      <ul className="check-list">
        {checks.map((check) => {
          const r = byId.get(check.id);
          const text = r
            ? resultText(r, results?.previous[check.id], results?.revision)
            : {};
          const status = r?.status ?? "unknown";
          return (
            <li key={check.id} className={`check-row ${status}`}>
              <div className="check-main">
                <span
                  className={`status-chip ${status}${r?.near ? " near" : ""}`}
                >
                  {status === "pass" && r?.near ? "near" : status}
                </span>
                <strong>{check.name}</strong>
                <span className="muted small">
                  {text.value ? `${text.value} · ` : ""}
                  {limitText(check)}
                </span>
              </div>
              {r?.reason && <p className="small reason">{r.reason}</p>}
              {text.change && <p className="small muted">{text.change}</p>}
              <p className="small faint">
                Last changed by {check.edited_by.email}
                {check.edited_by.agent ? " (agent)" : ""}
              </p>
              {props.canEdit && (
                <div className="row small">
                  <label>
                    <input
                      type="checkbox"
                      checked={check.enabled}
                      disabled={busy}
                      onChange={(e) =>
                        void save(
                          checks.map((c) =>
                            c.id === check.id
                              ? { ...c, enabled: e.target.checked }
                              : c,
                          ),
                        )
                      }
                    />{" "}
                    On
                  </label>
                  {limitFields(check.kind).length > 0 && (
                    <button
                      className="link"
                      onClick={() =>
                        setEditing(editing === check.id ? null : check.id)
                      }
                    >
                      Edit limit
                    </button>
                  )}
                  {r?.measure && props.canMeasure && (
                    <button className="link" onClick={() => void measure(r)}>
                      Measure
                    </button>
                  )}
                  <button
                    className="link"
                    disabled={busy}
                    onClick={() =>
                      void save(checks.filter((c) => c.id !== check.id))
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
              {editing === check.id && (
                <LimitEditor
                  check={check}
                  onCancel={() => setEditing(null)}
                  onSave={(limit) =>
                    void save(
                      checks.map((c) =>
                        c.id === check.id ? { ...c, limit } : c,
                      ),
                    )
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
      {props.canEdit && list && (
        <div className="row">
          <select
            aria-label="Add a check"
            value=""
            disabled={busy}
            onChange={(e) => {
              const [kind, index] = e.target.value.split(":");
              const drafts =
                kind === "pick"
                  ? [suggestions[Number(index)]]
                  : (list.presets.find((p) => p.id === index)?.checks ?? []);
              if (drafts.length)
                void save([
                  ...checks,
                  ...drafts.map((d) => ({ ...d, enabled: true })),
                ]);
            }}
          >
            <option value="">Add a check…</option>
            {suggestions.length > 0 && (
              <optgroup label="For the selection">
                {suggestions.map((s, i) => (
                  <option key={`pick-${i}`} value={`pick:${i}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Presets (limits to confirm)">
              {list.presets.map((p) => (
                <option
                  key={p.id}
                  value={`preset:${p.id}`}
                  title={p.description}
                >
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      )}
    </aside>
  );
}
