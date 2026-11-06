import { useState } from "react";
import {
  fieldsFor,
  type ActionSchema,
  type Field,
  type FormValues,
} from "./forms";

export type Preset = {
  id: string;
  version: number;
  action: string;
  name: string;
  description: string;
  inputs: FormValues;
};

/** How a reference reads in the form, in the same words the script uses. */
export function refText(value: unknown): string {
  if (Array.isArray(value)) return value.map(refText).join(", ");
  const v = value as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") return "";
  if (v.ref === "face")
    return "name" in v
      ? `face("${v.of}", "${v.name}")`
      : `face("${v.of}", near ${(v.near as number[]).map((n) => n.toFixed(1)).join(", ")})`;
  if (v.ref === "edges")
    return `edges("${v.of}", around "${v.around ?? (v.between as string[])?.join(" & ")}")`;
  if (v.ref === "datum") return `datum("${v.name}")`;
  if (v.ref === "part") return `part("${v.label}")`;
  return "";
}

/** A step form generated from the action's described inputs. Picks on the model fill reference fields. */
export function ActionForm(props: {
  action: ActionSchema;
  editing?: string;
  name: string;
  values: FormValues;
  active: string | null;
  params: string[];
  planes: string[];
  presets: Preset[];
  error: string;
  busy: boolean;
  canSavePreset: boolean;
  onName: (name: string) => void;
  onValues: (values: FormValues) => void;
  onActive: (field: string | null) => void;
  onSubmit: () => void;
  onSavePreset: (name: string, description: string) => void;
  onClose: () => void;
}) {
  const [help, setHelp] = useState(false);
  const [presetName, setPresetName] = useState<string | null>(null);
  const fields = fieldsFor(props.action, props.values).filter((f) => f.visible);
  const set = (name: string, value: unknown) =>
    props.onValues({ ...props.values, [name]: value });
  const input = (f: Field) => {
    const value = props.values[f.name];
    if (f.kind === "ref" || f.kind === "list") {
      if (f.refKinds?.length === 1 && f.refKinds[0] === "datum")
        return (
          <select
            value={(value as { name?: string })?.name ?? ""}
            onChange={(e) =>
              set(
                f.name,
                e.target.value
                  ? { ref: "datum", name: e.target.value }
                  : undefined,
              )
            }
          >
            <option value="">Choose a plane</option>
            {props.planes.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        );
      return (
        <div className="pick-field">
          <code>{refText(value) || "Nothing picked"}</code>
          <button
            type="button"
            className={`secondary ${props.active === f.name ? "on" : ""}`}
            aria-pressed={props.active === f.name}
            onClick={() =>
              props.onActive(props.active === f.name ? null : f.name)
            }
          >
            {props.active === f.name ? "Click the model…" : "Pick on model"}
          </button>
          {f.refKinds?.includes("datum") && props.planes.length > 0 && (
            <select
              aria-label={`${f.label}: or a plane`}
              value=""
              onChange={(e) =>
                e.target.value &&
                set(f.name, { ref: "datum", name: e.target.value })
              }
            >
              <option value="">or a plane…</option>
              {props.planes.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </div>
      );
    }
    if (f.kind === "choice")
      return (
        <select
          value={String(value ?? f.default ?? "")}
          onChange={(e) => set(f.name, e.target.value || undefined)}
        >
          {value === undefined && f.default === undefined && (
            <option value="">Choose…</option>
          )}
          {f.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    if (f.kind === "flag")
      return (
        <input
          type="checkbox"
          checked={Boolean(value ?? f.default)}
          onChange={(e) => set(f.name, e.target.checked)}
        />
      );
    if (f.kind === "vec3") {
      const v = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <div className="vec3">
          {["x", "y", "z"].map((axis, k) => (
            <input
              key={axis}
              aria-label={`${f.label} ${axis}`}
              type="number"
              step="any"
              placeholder={axis}
              value={typeof v[k] === "number" ? (v[k] as number) : ""}
              onChange={(e) => {
                const next = [0, 1, 2].map((j) =>
                  j === k
                    ? e.target.value === ""
                      ? undefined
                      : Number(e.target.value)
                    : v[j],
                );
                set(
                  f.name,
                  next.every((n) => n === undefined)
                    ? undefined
                    : next.map((n) => n ?? 0),
                );
              }}
            />
          ))}
        </div>
      );
    }
    if (f.kind === "number" || f.kind === "integer") {
      const param = (value as { param?: string })?.param;
      return (
        <div className="number-field">
          <input
            type="number"
            step={f.kind === "integer" ? 1 : "any"}
            min={f.min}
            max={f.max}
            placeholder={f.default !== undefined ? String(f.default) : ""}
            disabled={!!param}
            value={typeof value === "number" ? value : ""}
            onChange={(e) =>
              set(
                f.name,
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
          {f.unit && <span className="muted small">{f.unit}</span>}
          {f.unit === "mm" && props.params.length > 0 && (
            <select
              aria-label={`${f.label}: use a parameter`}
              value={param ?? ""}
              onChange={(e) =>
                set(
                  f.name,
                  e.target.value ? { param: e.target.value } : undefined,
                )
              }
            >
              <option value="">or a parameter…</option>
              {props.params.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </div>
      );
    }
    return (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => set(f.name, e.target.value || undefined)}
      />
    );
  };
  // Optional inputs with a default stay out of the way until asked for.
  const optional = (f: Field) =>
    !f.required && f.default !== undefined && f.kind !== "ref";
  const row = (f: Field) => (
    <label className="form-row" key={f.name} title={f.description}>
      <span>
        {f.label}
        {f.required ? " *" : ""}
      </span>
      {input(f)}
    </label>
  );
  return (
    <form
      className="popover action-form"
      role="dialog"
      aria-label={props.action.title ?? props.action.id}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="popover-head">
        <strong>
          {props.editing
            ? `Edit ${props.editing}`
            : (props.action.title ?? props.action.id)}
        </strong>
        <span>
          <button
            type="button"
            className="icon ghost"
            aria-label="About this action"
            onClick={() => setHelp(!help)}
          >
            ?
          </button>
          <button
            type="button"
            className="icon ghost"
            aria-label="Close"
            onClick={props.onClose}
          >
            ×
          </button>
        </span>
      </div>
      <p className="muted small">
        {help ? props.action.description : props.action.summary}
      </p>
      {!props.editing && (
        <label className="form-row">
          <span>Step name *</span>
          <input
            value={props.name}
            onChange={(e) => props.onName(e.target.value)}
            maxLength={80}
            required
          />
        </label>
      )}
      {props.presets.length > 0 && (
        <label className="form-row">
          <span>Preset</span>
          <select
            value=""
            onChange={(e) => {
              const preset = props.presets.find((p) => p.id === e.target.value);
              if (preset) props.onValues({ ...props.values, ...preset.inputs });
            }}
          >
            <option value="">Fill from a preset…</option>
            {props.presets.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {fields.filter((f) => !optional(f)).map(row)}
      {fields.some(optional) && (
        <details className="more-options">
          <summary>More options</summary>
          {fields.filter(optional).map(row)}
        </details>
      )}
      <p className="muted small">
        The dashed shape on the model is a preview; the build replaces it.
      </p>
      {props.error && (
        <p className="inline-error small" role="alert">
          {props.error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={props.busy}>
          {props.busy ? "Saving…" : props.editing ? "Save changes" : "Add step"}
        </button>
        {props.canSavePreset &&
          (presetName === null ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setPresetName("")}
            >
              Save as preset…
            </button>
          ) : (
            <span className="preset-save">
              <input
                aria-label="Preset name"
                placeholder="Preset name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <button
                type="button"
                className="secondary"
                disabled={!presetName.trim()}
                onClick={() => {
                  props.onSavePreset(
                    presetName.trim(),
                    `${props.action.title ?? props.action.id} preset: ${presetName.trim()}`,
                  );
                  setPresetName(null);
                }}
              >
                Save
              </button>
            </span>
          ))}
      </div>
    </form>
  );
}
