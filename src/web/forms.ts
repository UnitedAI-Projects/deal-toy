/** Form fields generated from an action's described input schema; the Worker still validates. */
type Schema = Record<string, unknown>;
export type ActionSchema = {
  id: string;
  title?: string;
  summary?: string;
  description?: string;
  inputs: Schema;
  preview?: string;
};
export type FieldKind =
  "number" | "integer" | "text" | "choice" | "flag" | "vec3" | "ref" | "list";
export type Field = {
  name: string;
  label: string;
  description: string;
  kind: FieldKind;
  unit?: string;
  min?: number;
  max?: number;
  default?: unknown;
  options?: string[];
  refKinds?: string[];
  /** For list fields: how many references to pick. */
  count?: number;
  required: boolean;
  visible: boolean;
};
export type FormValues = Record<string, unknown>;

const label = (name: string) =>
  (name.charAt(0).toUpperCase() + name.slice(1)).replace(/_/g, " ");
const kindsOf = (s: Schema) => {
  const kinds = s["x-ref"];
  return kinds === undefined
    ? undefined
    : Array.isArray(kinds)
      ? (kinds as string[])
      : [kinds as string];
};

type Condition = { field: string; value: unknown; required: string[] };
function conditions(inputs: Schema): Condition[] {
  return ((inputs.allOf ?? []) as Schema[]).map((c) => {
    const [[field, test]] = Object.entries(
      ((c.if as Schema).properties ?? {}) as Record<string, Schema>,
    );
    return {
      field,
      value: test.const,
      required: ((c.then as Schema).required ?? []) as string[],
    };
  });
}

function withDefaults(inputs: Schema, values: FormValues): FormValues {
  const out = { ...values };
  for (const [name, prop] of Object.entries(
    (inputs.properties ?? {}) as Record<string, Schema>,
  ))
    if (out[name] === undefined && "default" in prop) out[name] = prop.default;
  return out;
}

/** The fields to show for the current values: variant fields appear only when their variant is chosen. */
export function fieldsFor(action: ActionSchema, values: FormValues): Field[] {
  const inputs = action.inputs;
  const props = (inputs.properties ?? {}) as Record<string, Schema>;
  const base = new Set((inputs.required ?? []) as string[]);
  const current = withDefaults(inputs, values);
  const rules = conditions(inputs);
  const conditional = new Set(rules.flatMap((r) => r.required));
  const active = new Set(
    rules
      .filter((r) => current[r.field] === r.value)
      .flatMap((r) => r.required),
  );
  return Object.entries(props).map(([name, prop]) => {
    const items = prop.items as Schema | undefined;
    const refKinds = kindsOf(prop) ?? (items ? kindsOf(items) : undefined);
    let kind: FieldKind = "text";
    if (kindsOf(prop)) kind = "ref";
    else if (prop.type === "array" && items && kindsOf(items)) kind = "list";
    else if (
      prop.type === "array" &&
      prop.minItems === 3 &&
      prop.maxItems === 3
    )
      kind = "vec3";
    else if (prop.type === "number") kind = "number";
    else if (prop.type === "integer") kind = "integer";
    else if (prop.type === "boolean") kind = "flag";
    else if (prop.type === "string" && Array.isArray(prop.enum))
      kind = "choice";
    const field: Field = {
      name,
      label: label(name),
      description: String(prop.description ?? ""),
      kind,
      required: base.has(name) || active.has(name),
      visible: base.has(name) || !conditional.has(name) || active.has(name),
    };
    const unit = prop.unit ?? items?.unit;
    if (unit && unit !== "count") field.unit = String(unit);
    if (typeof prop.minimum === "number") field.min = prop.minimum;
    if (typeof prop.maximum === "number") field.max = prop.maximum;
    if ("default" in prop) field.default = prop.default;
    if (Array.isArray(prop.enum)) field.options = prop.enum as string[];
    if (refKinds) field.refKinds = refKinds;
    if (kind === "list")
      field.count = Number(prop.maxItems ?? prop.minItems ?? 1);
    return field;
  });
}

const filled = (v: unknown) =>
  v !== undefined &&
  v !== "" &&
  !(Array.isArray(v) && v.every((x) => x === undefined || x === ""));

/** The inputs to send: visible fields with a value. Hidden variant fields are never sent. */
export function submitValues(
  action: ActionSchema,
  values: FormValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsFor(action, values))
    if (field.visible && filled(values[field.name]))
      out[field.name] = values[field.name];
  return out;
}

/**
 * Puts a picked reference into the active pick field (appending for lists) and returns the next
 * visible pick field that still needs one, so picking flows from field to field.
 */
export function applyPick(
  fields: Field[],
  values: FormValues,
  active: string,
  ref: unknown,
): { values: FormValues; next: string | null } {
  const field = fields.find((f) => f.name === active);
  if (!field) return { values, next: null };
  const next = { ...values };
  if (field.kind === "list") {
    const list = (
      Array.isArray(values[active]) ? (values[active] as unknown[]) : []
    ).slice(0, (field.count ?? 1) - 1);
    next[active] = [...list, ref];
  } else next[active] = ref;
  const pending = fields.find((f) => {
    if (
      !f.visible ||
      (f.kind !== "ref" && f.kind !== "list") ||
      (f.name === active && f.kind !== "list")
    )
      return false;
    const v = next[f.name];
    return f.kind === "list"
      ? !Array.isArray(v) || v.length < (f.count ?? 1)
      : v === undefined;
  });
  return { values: next, next: pending?.name ?? null };
}
