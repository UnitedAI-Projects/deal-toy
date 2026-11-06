import { AppError } from "../core";
import type { ActionRecord, JsonSchema } from "./catalog";
import type { StepValue } from "./script";

/**
 * Validates step inputs against the catalog's JSON Schema subset. The engine runs the same
 * checks (engine/lib/mantel/schema.py) on whatever the script contains.
 */
const KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "items",
  "minItems",
  "maxItems",
  "oneOf",
  "allOf",
  "if",
  "then",
  "x-ref",
  "description",
  "unit",
  "default",
]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Keywords outside the subset, so the catalog cannot silently rely on one. */
export function unsupportedKeywords(schema: JsonSchema): string[] {
  const out = Object.keys(schema).filter((k) => !KEYWORDS.has(k));
  const nested: JsonSchema[] = [
    ...Object.values((schema.properties ?? {}) as Record<string, JsonSchema>),
    ...((schema.oneOf ?? []) as JsonSchema[]),
    ...((schema.allOf ?? []) as JsonSchema[]),
  ];
  for (const key of ["items", "if", "then"])
    if (schema[key]) nested.push(schema[key] as JsonSchema);
  return [...new Set([...out, ...nested.flatMap(unsupportedKeywords)])];
}

class Invalid extends Error {}
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => k in v);
const text = (v: unknown, max = 120) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const triple = (v: unknown) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === "number" && Number.isFinite(n));

function isRef(kind: string, v: unknown): boolean {
  if (!plain(v)) return false;
  switch (kind) {
    case "fn":
      return (
        exactKeys(v, ["fn"]) && typeof v.fn === "string" && IDENT.test(v.fn)
      );
    case "face":
      return (
        v.ref === "face" &&
        text(v.of) &&
        ((exactKeys(v, ["ref", "of", "name"]) && text(v.name)) ||
          (exactKeys(v, ["ref", "of", "normal", "near"]) &&
            triple(v.normal) &&
            triple(v.near)))
      );
    case "edges":
      return (
        v.ref === "edges" &&
        text(v.of) &&
        ((exactKeys(v, ["ref", "of", "around"]) && text(v.around)) ||
          (exactKeys(v, ["ref", "of", "between"]) &&
            Array.isArray(v.between) &&
            v.between.length === 2 &&
            v.between.every((s) => text(s))))
      );
    case "datum":
      return v.ref === "datum" && exactKeys(v, ["ref", "name"]) && text(v.name);
    case "part":
      return (
        v.ref === "part" && exactKeys(v, ["ref", "label"]) && text(v.label)
      );
    case "point":
      return v.ref === "point" && exactKeys(v, ["ref", "at"]) && triple(v.at);
  }
  return false;
}

const isParam = (v: unknown) =>
  plain(v) &&
  exactKeys(v, ["param"]) &&
  typeof v.param === "string" &&
  IDENT.test(v.param);

function check(schema: JsonSchema, value: unknown, path: string): void {
  const ref = schema["x-ref"] as string | string[] | undefined;
  if (ref !== undefined) {
    const kinds = Array.isArray(ref) ? ref : [ref];
    if (!kinds.some((k) => isRef(k, value)))
      throw new Invalid(`${path} must be a ${kinds.join(" or ")} reference`);
    return;
  }
  if ("const" in schema) {
    if (value !== schema.const)
      throw new Invalid(`${path} must be ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.oneOf) {
    const passing = (schema.oneOf as JsonSchema[]).filter((branch) => {
      try {
        check(branch, value, path);
        return true;
      } catch (error) {
        if (error instanceof Invalid) return false;
        throw error;
      }
    });
    if (passing.length !== 1)
      throw new Invalid(`${path} does not match exactly one allowed form`);
    return;
  }
  const type = schema.type;
  if (type === "number" || type === "integer") {
    if (isParam(value)) return;
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Invalid(`${path} must be a number`);
    if (type === "integer" && !Number.isInteger(value))
      throw new Invalid(`${path} must be a whole number`);
    const unit =
      schema.unit && schema.unit !== "count" ? ` ${String(schema.unit)}` : "";
    if (typeof schema.minimum === "number" && value < schema.minimum)
      throw new Invalid(`${path} must be at least ${schema.minimum}${unit}`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      throw new Invalid(`${path} must be at most ${schema.maximum}${unit}`);
  } else if (type === "string") {
    if (typeof value !== "string") throw new Invalid(`${path} must be text`);
    const min = (schema.minLength as number | undefined) ?? 0;
    const max = (schema.maxLength as number | undefined) ?? Infinity;
    if (value.length < min || value.length > max)
      throw new Invalid(`${path} must be ${min} to ${max} characters`);
  } else if (type === "boolean") {
    if (typeof value !== "boolean")
      throw new Invalid(`${path} must be true or false`);
  } else if (type === "array") {
    if (!Array.isArray(value)) throw new Invalid(`${path} must be a list`);
    const min = (schema.minItems as number | undefined) ?? 0;
    const max = (schema.maxItems as number | undefined) ?? Infinity;
    if (value.length < min || value.length > max)
      throw new Invalid(
        `${path} must have ${min === max ? min : `${min} to ${max}`} items`,
      );
    if (schema.items)
      value.forEach((item, i) =>
        check(schema.items as JsonSchema, item, `${path}[${i}]`),
      );
  } else if (type === "object") {
    if (!plain(value)) throw new Invalid(`${path} must be an object`);
    checkObject(schema, value, path, path);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    throw new Invalid(`${path} must be one of ${schema.enum.join(", ")}`);
}

function checkObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  owner: string,
) {
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const join = (key: string) => (path ? `${path}.${key}` : key);
  const withDefaults: Record<string, unknown> = { ...value };
  for (const [key, prop] of Object.entries(props))
    if (!(key in withDefaults) && "default" in prop)
      withDefaults[key] = prop.default;
  for (const key of (schema.required ?? []) as string[])
    if (!(key in value)) throw new Invalid(`${join(key)} is required`);
  for (const condition of (schema.allOf ?? []) as JsonSchema[]) {
    const test = Object.entries(
      ((condition.if as JsonSchema).properties ?? {}) as Record<
        string,
        JsonSchema
      >,
    );
    if (!test.every(([k, v]) => withDefaults[k] === v.const)) continue;
    for (const key of ((condition.then as JsonSchema).required ??
      []) as string[])
      if (!(key in value))
        throw new Invalid(
          `${join(key)} is required when ${test[0][0]} is ${String(test[0][1].const)}`,
        );
  }
  for (const [key, item] of Object.entries(value)) {
    if (key in props) check(props[key], item, join(key));
    else if (!schema.additionalProperties)
      throw new Invalid(`${join(key)} is not an input of ${owner}`);
    else if (!IDENT.test(key))
      throw new Invalid(`${key} is not a valid input name`);
  }
}

const SAVED_KEY = /^[a-z][a-z0-9-]{1,39}@[0-9]{1,6}$/;

/**
 * Checks a step's inputs; returns them unchanged (defaults stay implicit) or refuses with 400.
 * A custom step names exactly one of `fn` or `action`; with `action`, pass that saved action's record
 * so its own inputs are checked.
 */
export function validateInputs(
  action: ActionRecord,
  inputs: unknown,
  saved?: ActionRecord,
): Record<string, StepValue> {
  if (!plain(inputs)) throw new AppError(400, "inputs must be an object");
  try {
    if (action.id === "custom") {
      if ("fn" in inputs === "action" in inputs)
        throw new Invalid(
          "A custom step needs exactly one of fn or action (a saved action as id@version)",
        );
      if ("action" in inputs) {
        const { action: key, ...rest } = inputs;
        if (typeof key !== "string" || !SAVED_KEY.test(key))
          throw new Invalid(
            "action must be a saved action as id@version, for example finger-notch@2",
          );
        if (!saved || saved.id !== key)
          throw new AppError(404, `No saved action ${key}`);
        checkObject(saved.inputs, rest, "", key);
        return inputs as Record<string, StepValue>;
      }
    }
    checkObject(action.inputs, inputs, "", action.id);
  } catch (error) {
    if (error instanceof Invalid) throw new AppError(400, error.message);
    throw error;
  }
  return inputs as Record<string, StepValue>;
}
