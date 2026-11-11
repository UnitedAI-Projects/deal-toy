/* What a model revision holds: build123d Python (legacy models) or a MantelCAD design, the plain
   JSON document MantelCAD's document.export returns and mantelcad-cli reads. engine/service.py
   applies the same test (design_of) and the same command rules. */

export const MAX_PYTHON_BYTES = 100_000;
export const MAX_DESIGN_BYTES = 1_000_000;
export const MAX_EDIT_COMMANDS = 60;

const DESIGN_FORMAT = /^solidcraft\/[0-9]{1,4}$/;

export type Design = {
  format: string;
  name?: string;
  params?: {
    name?: unknown;
    expr?: unknown;
    unit?: unknown;
    model?: unknown;
  }[];
  features?: {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    suppressed?: unknown;
  }[];
  [key: string]: unknown;
};

/** The design a source holds, or null for anything else (such as build123d Python). */
export function designOf(source: string): Design | null {
  if (!source.trimStart().startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Design).format === "string" &&
    DESIGN_FORMAT.test((value as Design).format)
    ? (value as Design)
    : null;
}

export const isDesign = (source: string | undefined) =>
  source !== undefined && designOf(source) !== null;

/** Modelling command families an edit may use; never file, render, view, interface or settings. */
export const COMMAND_FAMILIES = [
  "sketch",
  "solid",
  "construct",
  "parameters",
  "timeline",
  "appearance",
  "material",
  "body",
  "surface",
  "sheet",
  "component",
  "joint",
  "occurrence",
  "plastic",
] as const;
const COMMAND = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/;
/** Commands that read or write other files: a design Mantel builds is self-contained. */
const COMMAND_DENIED =
  /(export|import|insert|extract|links|edit_in_place|finish_edit|paste|break_link|replace)/;

/** Why a command may not be used in an edit, or null when it may. */
export function commandProblem(name: string): string | null {
  if (!COMMAND.test(name)) return `${name} is not a MantelCAD command name`;
  if (!(COMMAND_FAMILIES as readonly string[]).includes(name.split(".")[0]))
    return `${name} is not a modelling command (use ${COMMAND_FAMILIES.join(", ")})`;
  if (COMMAND_DENIED.test(name))
    return `${name} reads or writes other files, which a model's design cannot`;
  return null;
}

const LITERAL =
  /^\s*(-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?)\s*([A-Za-z]{0,8})\s*$/;

/** The design with one of its named parameters set to a plain value; refuses anything else. */
export function setDesignParameter(
  source: string,
  name: string,
  value: number,
): string {
  const design = designOf(source);
  if (!design) throw new Error("This revision is not a MantelCAD design");
  if (!Number.isFinite(value)) throw new Error("Value must be a number");
  const matches = (design.params ?? []).filter(
    (p) => p && p.name === name && p.model === false,
  );
  if (matches.length !== 1)
    throw new Error(`The design has no parameter named ${name}`);
  const param = matches[0];
  const literal =
    typeof param.expr === "string" ? LITERAL.exec(param.expr) : null;
  if (!literal)
    throw new Error(
      `${name} is an expression (${String(param.expr)}); change it in MantelCAD`,
    );
  const unit = literal[2] || (typeof param.unit === "string" ? param.unit : "");
  param.expr = unit ? `${value} ${unit}` : String(value);
  return JSON.stringify(design);
}

/** A short account of a design for the agent: its parameters and features, in timeline order. */
export function designSummary(design: Design) {
  return {
    name: typeof design.name === "string" ? design.name : undefined,
    units: typeof design.units === "string" ? design.units : undefined,
    parameters: (design.params ?? [])
      .filter((p) => p && p.model === false && typeof p.name === "string")
      .slice(0, 100)
      .map((p) => ({ name: p.name, expression: p.expr })),
    features: (design.features ?? []).slice(0, 200).map((f) => ({
      id: f.id,
      type: f.type,
      name: f.name,
      ...(f.suppressed === true ? { suppressed: true } : {}),
    })),
  };
}
