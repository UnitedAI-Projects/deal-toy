import { AppError } from "../core";
import { designOf } from "../../shared/cad-source";

/**
 * The steps section of a model script: the statements between `# mantel:steps begin` and
 * `# mantel:steps end` inside `build()`. Each statement is one `m.<action>("Name", key=value)`
 * call in a restricted grammar, so the Worker can read and rewrite steps without running Python.
 * Bytes outside the markers never change.
 */
export type Ref =
  | { ref: "face"; of: string; name: string }
  | {
      ref: "face";
      of: string;
      normal: [number, number, number];
      near: [number, number, number];
    }
  | { ref: "edges"; of: string; between: [string, string] }
  | { ref: "edges"; of: string; around: string }
  | { ref: "datum"; name: string }
  | { ref: "part"; label: string }
  | { ref: "point"; at: [number, number, number] }
  | { fn: string }
  | { param: string };
export type StepValue =
  | number
  | string
  | boolean
  | null
  | Ref
  | StepValue[]
  | { [key: string]: StepValue };
export type Step = {
  action: string;
  name: string;
  inputs: Record<string, StepValue>;
  suppressed: boolean;
  /** The statement as written, kept so untouched steps are rewritten byte for byte. */
  raw?: { leading: string; text: string; key: string };
};

const BEGIN = "# mantel:steps begin";
const END = "# mantel:steps end";
/** The standard layout with no steps yet, written when step tools start an empty model. */
export const STARTER_SOURCE = [
  "import build123d as bd",
  "import mantel as mt",
  "",
  "PARAMS = {}",
  "",
  "",
  "def base():",
  "    return None",
  "",
  "",
  "def build():",
  "    m = mt.Model(base(), params=PARAMS)",
  `    ${BEGIN}`,
  `    ${END}`,
  "    return m.result()",
  "",
].join("\n");
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NO_SECTION =
  "This model has no steps section; ask the agent to adopt the standard model layout";
const MALFORMED =
  "The steps section is malformed; ask the agent to tidy the steps section";

/** Comment tokens of a Python source, skipping everything inside string literals. */
function comments(source: string) {
  const found: { start: number; end: number }[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "#") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? source.length : nl;
      found.push({ start: i, end });
      i = end;
    } else if (ch === '"' || ch === "'") {
      const triple = source.startsWith(ch.repeat(3), i);
      const quote = triple ? ch.repeat(3) : ch;
      for (i += quote.length; i < source.length; i++) {
        if (source[i] === "\\") i++;
        else if (source.startsWith(quote, i)) {
          i += quote.length - 1;
          break;
        } else if (!triple && source[i] === "\n") break;
      }
    }
  }
  return found;
}

const lineStart = (source: string, at: number) =>
  source.lastIndexOf("\n", at - 1) + 1;
const lineNumber = (source: string, at: number) =>
  source.slice(0, at).split("\n").length;

function locate(source: string) {
  const markers = comments(source).flatMap((c) => {
    const start = lineStart(source, c.start);
    const indent = source.slice(start, c.start);
    const text = source.slice(c.start, c.end).trimEnd();
    if (!/^[ \t]*$/.test(indent) || (text !== BEGIN && text !== END)) return [];
    return [{ begin: text === BEGIN, start, end: c.end, indent }];
  });
  const begins = markers.filter((m) => m.begin);
  const ends = markers.filter((m) => !m.begin);
  if (!begins.length && !ends.length) throw new AppError(400, NO_SECTION);
  if (begins.length > 1 || ends.length > 1)
    throw new AppError(
      400,
      "The model has more than one steps section; ask the agent to tidy the steps section",
    );
  const [begin] = begins;
  const [end] = ends;
  if (!begin || !end || begin.start > end.start || begin.indent !== end.indent)
    throw new AppError(400, MALFORMED);
  // The section must sit directly inside `def build(`.
  const before = source.slice(0, begin.start).split("\n");
  const owner = before
    .reverse()
    .find(
      (line) =>
        line.trim() &&
        !line.trim().startsWith("#") &&
        line.length - line.trimStart().length < begin.indent.length,
    );
  if (!begin.indent || !owner || !/^\s*def build\(/.test(owner))
    throw new AppError(400, MALFORMED);
  const sectionStart = source.indexOf("\n", begin.end) + 1;
  return { start: sectionStart, end: end.start, indent: begin.indent };
}

type Token = {
  kind: "name" | "number" | "string" | "op" | "newline";
  text: string;
  value?: string | number;
  start: number;
  end: number;
};

class NotAStep extends Error {}

function tokenize(text: string, offset: number): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\r") i++;
    else if (ch === "\\" && text[i + 1] === "\n") i += 2;
    else if (ch === "#") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
    } else if (ch === "\n") {
      if (depth === 0)
        tokens.push({
          kind: "newline",
          text: ch,
          start: i + offset,
          end: i + offset + 1,
        });
      i++;
    } else if (ch === '"' || ch === "'") {
      if (text.startsWith(ch.repeat(3), i))
        throw new NotAStep(String(i + offset));
      let value = "";
      let j = i + 1;
      for (; j < text.length && text[j] !== ch; j++) {
        if (text[j] === "\n") throw new NotAStep(String(i + offset));
        if (text[j] !== "\\") {
          value += text[j];
          continue;
        }
        const e = text[++j];
        const simple: Record<string, string> = {
          n: "\n",
          t: "\t",
          r: "\r",
          b: "\b",
          f: "\f",
          "0": "\0",
          "\\": "\\",
          "'": "'",
          '"': '"',
        };
        if (e in simple) value += simple[e];
        else if (e === "x" || e === "u") {
          const width = e === "x" ? 2 : 4;
          const hex = text.slice(j + 1, j + 1 + width);
          if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex))
            throw new NotAStep(String(i + offset));
          value += String.fromCharCode(parseInt(hex, 16));
          j += width;
        } else throw new NotAStep(String(i + offset));
      }
      if (j >= text.length) throw new NotAStep(String(i + offset));
      tokens.push({
        kind: "string",
        text: text.slice(i, j + 1),
        value,
        start: i + offset,
        end: j + 1 + offset,
      });
      i = j + 1;
    } else if (
      /[0-9]/.test(ch) ||
      (ch === "." && /[0-9]/.test(text[i + 1] ?? ""))
    ) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(
        text.slice(i),
      )!;
      if (/^[A-Za-z_]/.test(text.slice(i + match[0].length)))
        throw new NotAStep(String(i + offset));
      tokens.push({
        kind: "number",
        text: match[0],
        value: Number(match[0]),
        start: i + offset,
        end: i + match[0].length + offset,
      });
      i += match[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))!;
      tokens.push({
        kind: "name",
        text: match[0],
        start: i + offset,
        end: i + match[0].length + offset,
      });
      i += match[0].length;
    } else {
      if ("([{".includes(ch)) depth++;
      if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
      tokens.push({
        kind: "op",
        text: ch,
        start: i + offset,
        end: i + offset + 1,
      });
      i++;
    }
  }
  return tokens;
}

class Parser {
  i = 0;
  constructor(private tokens: Token[]) {}
  peek(n = 0) {
    return this.tokens[this.i + n];
  }
  next() {
    const t = this.tokens[this.i++];
    if (!t) throw new NotAStep("");
    return t;
  }
  op(text: string) {
    const t = this.next();
    if (t.kind !== "op" || t.text !== text) throw new NotAStep("");
  }
  isOp(text: string, n = 0) {
    const t = this.peek(n);
    return t?.kind === "op" && t.text === text;
  }
  name(text?: string) {
    const t = this.next();
    if (t.kind !== "name" || (text !== undefined && t.text !== text))
      throw new NotAStep("");
    return t.text;
  }
  string() {
    const t = this.next();
    if (t.kind !== "string") throw new NotAStep("");
    return t.value as string;
  }
  number(): number {
    if (this.isOp("-")) {
      this.next();
      return -this.number();
    }
    const t = this.next();
    if (t.kind !== "number") throw new NotAStep("");
    return t.value as number;
  }
  triple(): [number, number, number] {
    const items = this.sequence(")", () => this.number(), "(");
    if (items.length !== 3) throw new NotAStep("");
    return items as [number, number, number];
  }
  /** Comma-separated items up to `close`; returns them and whether a trailing comma was seen. */
  sequence<T>(close: string, item: () => T, open?: string) {
    if (open) this.op(open);
    const items: T[] = [];
    while (!this.isOp(close)) {
      items.push(item());
      if (this.isOp(",")) this.next();
      else if (!this.isOp(close)) throw new NotAStep("");
    }
    this.op(close);
    return items;
  }
  /** Keyword arguments `key=value` up to `)`, after the call's positional arguments. */
  keywords(value: () => StepValue) {
    const out: Record<string, StepValue> = {};
    while (!this.isOp(")")) {
      const key = this.name();
      this.op("=");
      if (key in out) throw new NotAStep("");
      out[key] = value();
      if (this.isOp(",")) this.next();
      else if (!this.isOp(")")) throw new NotAStep("");
    }
    this.op(")");
    return out;
  }
  value(): StepValue {
    const t = this.peek();
    if (!t) throw new NotAStep("");
    if (t.kind === "number" || (t.kind === "op" && t.text === "-"))
      return this.number();
    if (t.kind === "string") return this.string();
    if (t.kind === "op" && t.text === "[")
      return this.sequence("]", () => this.value(), "[");
    if (t.kind === "op" && t.text === "{") {
      this.next();
      const out: Record<string, StepValue> = {};
      while (!this.isOp("}")) {
        const key = this.string();
        this.op(":");
        out[key] = this.value();
        if (this.isOp(",")) this.next();
        else if (!this.isOp("}")) throw new NotAStep("");
      }
      this.op("}");
      return out;
    }
    if (t.kind === "op" && t.text === "(") {
      this.next();
      const items: StepValue[] = [];
      let comma = false;
      while (!this.isOp(")")) {
        items.push(this.value());
        comma = this.isOp(",");
        if (comma) this.next();
        else if (!this.isOp(")")) throw new NotAStep("");
      }
      this.op(")");
      return items.length === 1 && !comma ? items[0] : items;
    }
    if (t.kind !== "name") throw new NotAStep("");
    if (t.text === "True" || t.text === "False" || t.text === "None") {
      this.next();
      return t.text === "None" ? null : t.text === "True";
    }
    if (t.text === "mt" && this.isOp(".", 1)) {
      this.next();
      this.op(".");
      this.name("P");
      this.op("(");
      const param = this.string();
      this.op(")");
      return { param };
    }
    if (t.text === "m" && this.isOp(".", 1)) return this.reference();
    this.next();
    if (this.isOp("(") || this.isOp(".")) throw new NotAStep("");
    return { fn: t.text };
  }
  reference(): Ref {
    this.name("m");
    this.op(".");
    const kind = this.name();
    this.op("(");
    if (kind === "point") {
      const at = [this.number()];
      for (let k = 0; k < 2; k++) {
        this.op(",");
        at.push(this.number());
      }
      if (this.isOp(",")) this.next();
      this.op(")");
      return { ref: "point", at: at as [number, number, number] };
    }
    const first = this.string();
    if (kind === "datum" || kind === "part") {
      if (this.isOp(",")) this.next();
      this.op(")");
      return kind === "datum"
        ? { ref: "datum", name: first }
        : { ref: "part", label: first };
    }
    if (kind === "face" && this.isOp(",") && this.peek(1)?.kind === "string") {
      this.next();
      const name = this.string();
      if (this.isOp(",")) this.next();
      this.op(")");
      return { ref: "face", of: first, name };
    }
    if (this.isOp(",")) this.next();
    const keys: Record<string, unknown> = {};
    while (!this.isOp(")")) {
      const key = this.name();
      this.op("=");
      if (kind === "face" && (key === "normal" || key === "near"))
        keys[key] = this.triple();
      else if (kind === "edges" && key === "between") {
        const pair = this.sequence(")", () => this.string(), "(");
        if (pair.length !== 2) throw new NotAStep("");
        keys[key] = pair;
      } else if (kind === "edges" && key === "around")
        keys[key] = this.string();
      else throw new NotAStep("");
      if (this.isOp(",")) this.next();
      else if (!this.isOp(")")) throw new NotAStep("");
    }
    this.op(")");
    if (
      kind === "face" &&
      keys.normal &&
      keys.near &&
      Object.keys(keys).length === 2
    )
      return {
        ref: "face",
        of: first,
        normal: keys.normal as [number, number, number],
        near: keys.near as [number, number, number],
      };
    if (kind === "edges" && Object.keys(keys).length === 1 && keys.between)
      return {
        ref: "edges",
        of: first,
        between: keys.between as [string, string],
      };
    if (kind === "edges" && Object.keys(keys).length === 1 && keys.around)
      return { ref: "edges", of: first, around: keys.around as string };
    throw new NotAStep("");
  }
  statement(): Omit<Step, "raw"> {
    this.name("m");
    this.op(".");
    const action = this.name();
    this.op("(");
    const name = this.string();
    if (this.isOp(",")) this.next();
    else if (!this.isOp(")")) throw new NotAStep("");
    const inputs = this.keywords(() => this.value());
    let suppressed = false;
    if ("suppressed" in inputs) {
      if (typeof inputs.suppressed !== "boolean") throw new NotAStep("");
      suppressed = inputs.suppressed;
      delete inputs.suppressed;
    }
    const end = this.peek();
    if (end && end.kind !== "newline") throw new NotAStep("");
    return { action, name, inputs, suppressed };
  }
}

/** A key that is equal for two steps exactly when they render the same call. */
function keyOf(step: Pick<Step, "action" | "name" | "inputs" | "suppressed">) {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(
    sort([step.action, step.name, step.inputs, step.suppressed]),
  );
}

function parseSection(source: string, start: number, end: number) {
  const text = source.slice(start, end);
  const fail = (at: number): never => {
    throw new AppError(
      400,
      `Line ${lineNumber(source, at)} is not a step; ask the agent to tidy the steps section`,
    );
  };
  let tokens: Token[];
  try {
    tokens = tokenize(text, start);
  } catch (error) {
    if (error instanceof NotAStep) fail(Number(error.message) || start);
    throw error;
  }
  const steps: Step[] = [];
  let cursor = start; // where the next step's leading text begins
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].kind === "newline") {
      i++;
      continue;
    }
    let close = i;
    while (close < tokens.length && tokens[close].kind !== "newline") close++;
    const first = tokens[i];
    let parsed: Omit<Step, "raw">;
    try {
      parsed = new Parser(tokens.slice(i, close + 1)).statement();
    } catch (error) {
      if (error instanceof NotAStep) fail(first.start);
      throw error;
    }
    const lineBegin = lineStart(source, first.start);
    const lineEnd = close < tokens.length ? tokens[close].end : end;
    steps.push({
      ...parsed,
      raw: {
        leading: source.slice(cursor, lineBegin),
        text: source.slice(lineBegin, lineEnd),
        key: keyOf(parsed),
      },
    });
    cursor = lineEnd;
    i = close + 1;
  }
  return { steps, trailing: source.slice(cursor, end) };
}

/** Reads the steps section, or refuses with a message the person or agent can act on. */
export function readSteps(source: string): {
  steps: Step[];
  start: number;
  end: number;
} {
  if (designOf(source))
    throw new AppError(
      400,
      "This model is a MantelCAD design: it has no build123d steps. Edit it in MantelCAD, or with models_edit and models_set_parameter.",
    );
  const { start, end } = locate(source);
  return { steps: parseSection(source, start, end).steps, start, end };
}

const pyString = (s: string) => JSON.stringify(s);
function pyNumber(n: number) {
  if (!Number.isFinite(n)) throw new AppError(400, "Numbers must be finite");
  return Object.is(n, -0) ? "0" : String(n);
}
const isScalarNumber = (v: StepValue) =>
  typeof v === "number" || (!!v && typeof v === "object" && "param" in v);

/** A value as it is written in a step call, for example m.face("Base", "bottom"). */
export function pyValue(value: StepValue): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return pyNumber(value);
  if (typeof value === "string") return pyString(value);
  if (Array.isArray(value)) {
    if (value.length && value.every(isScalarNumber))
      return value.length === 1
        ? `(${pyValue(value[0])},)`
        : `(${value.map(pyValue).join(", ")})`;
    return `[${value.map(pyValue).join(", ")}]`;
  }
  if ("param" in value && typeof value.param === "string")
    return `mt.P(${pyString(value.param)})`;
  if ("fn" in value && typeof value.fn === "string") {
    if (!IDENT.test(value.fn))
      throw new AppError(400, "A function name must be a Python identifier");
    return value.fn;
  }
  if ("ref" in value) {
    const r = value as Exclude<Ref, { fn: string } | { param: string }>;
    switch (r.ref) {
      case "face":
        return "name" in r
          ? `m.face(${pyString(r.of)}, ${pyString(r.name)})`
          : `m.face(${pyString(r.of)}, normal=${pyValue(r.normal)}, near=${pyValue(r.near)})`;
      case "edges":
        return "between" in r
          ? `m.edges(${pyString(r.of)}, between=(${r.between.map(pyString).join(", ")}))`
          : `m.edges(${pyString(r.of)}, around=${pyString(r.around)})`;
      case "datum":
        return `m.datum(${pyString(r.name)})`;
      case "part":
        return `m.part(${pyString(r.label)})`;
      case "point":
        return `m.point(${r.at.map(pyNumber).join(", ")})`;
    }
  }
  const entries = Object.entries(value as Record<string, StepValue>);
  return `{${entries.map(([k, v]) => `${pyString(k)}: ${pyValue(v)}`).join(", ")}}`;
}

/** One step as a single statement, with a trailing newline. */
export function renderStep(step: Step, indent = "    "): string {
  if (!IDENT.test(step.action)) throw new AppError(400, "Invalid action id");
  const args = [pyString(step.name)];
  for (const [key, value] of Object.entries(step.inputs)) {
    if (!IDENT.test(key) || key === "suppressed")
      throw new AppError(400, `Invalid input name ${key}`);
    args.push(`${key}=${pyValue(value)}`);
  }
  if (step.suppressed) args.push("suppressed=True");
  return `${indent}m.${step.action}(${args.join(", ")})\n`;
}

/** Replaces the steps section with `steps`; untouched steps keep their original text. */
export function writeSteps(source: string, steps: Step[]): string {
  const { start, end, indent } = locate(source);
  const { trailing } = parseSection(source, start, end);
  const body = steps
    .map((step) =>
      step.raw && step.raw.key === keyOf(step)
        ? step.raw.leading + step.raw.text
        : (step.raw?.leading ?? "") + renderStep(step, indent),
    )
    .join("");
  return source.slice(0, start) + body + trailing + source.slice(end);
}

/** A step without its source bookkeeping, for tool results. */
export function publicStep({ raw: _raw, ...step }: Step) {
  return step;
}
