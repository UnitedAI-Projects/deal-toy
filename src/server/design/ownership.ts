import { AppError } from "../core";
import { readSteps, type Step, type StepValue } from "../actions/script";

/**
 * Which parts of a model script a write changed, worked out by comparing the old and new source
 * in the Worker without running Python. The guard uses it to decide whether a write stays inside
 * the layers its change plan declares.
 */
export type SourceChange = {
  /** The after source has a parsable steps section. */
  layout: boolean;
  /** base() is exactly `return None` (comments/docstring allowed); "missing" when there is no base(). */
  base: "empty" | "code" | "missing";
  /** Layer names only in after. */
  added: string[];
  /** Layer names only in before. */
  removed: string[];
  /** Layers whose statement changed, or whose fn= function changed. */
  edited: string[];
  /** Layers whose position changed relative to the layers around them. */
  moved: string[];
  /** The PARAMS literal changed. */
  params: boolean;
  /** Any other top-level code, or build() outside the markers, changed. */
  shared: boolean;
};

type Chunk = { key: string; text: string };

const SECTION = "\n    # (steps)\n";

/** Steps of a source, or null when it has no readable steps section. */
function stepsOf(source: string): Step[] | null {
  try {
    return readSteps(source).steps;
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

export function layerNames(source: string): string[] | null {
  return stepsOf(source)?.map((s) => s.name) ?? null;
}

/**
 * For each line, whether it begins inside an open bracket, a triple-quoted string or after a
 * backslash continuation, so it cannot start a top-level chunk.
 */
function continuationLines(source: string): boolean[] {
  const result: boolean[] = [false];
  let depth = 0;
  let triple: string | null = null;
  let backslash = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\n") {
      result.push(depth > 0 || triple !== null || backslash);
      backslash = false;
      continue;
    }
    if (triple) {
      if (ch === "\\") i++;
      else if (source.startsWith(triple, i)) {
        i += 2;
        triple = null;
      }
      continue;
    }
    if (ch === "#") {
      const nl = source.indexOf("\n", i);
      i = (nl === -1 ? source.length : nl) - 1;
    } else if (ch === '"' || ch === "'") {
      if (source.startsWith(ch.repeat(3), i)) {
        triple = ch.repeat(3);
        i += 2;
      } else {
        for (i++; i < source.length && source[i] !== ch; i++) {
          if (source[i] === "\\") i++;
          else if (source[i] === "\n") {
            i--;
            break;
          }
        }
      }
    } else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === "\\" && source[i + 1] === "\n") backslash = true;
    else if (ch !== " " && ch !== "\t" && ch !== "\r") backslash = false;
  }
  return result;
}

function keyOf(head: string): string {
  const def = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(head);
  if (def) {
    if (def[1] === "build") return "build";
    if (def[1] === "base") return "base";
    return `fn:${def[1]}`;
  }
  if (/^PARAMS\s*(?::[^=]*)?=/.test(head)) return "params";
  return "shared";
}

/** Strips trailing whitespace, drops blank lines at the ends and collapses runs of them. */
function normalize(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits a module into top-level chunks. A chunk starts at a non-blank line in column 0 that is
 * not a comment or a continuation; comments and decorators above it belong to it.
 */
function chunks(source: string): Chunk[] {
  const lines = source.split("\n");
  const continued = continuationLines(source);
  const found: Chunk[] = [];
  let pending: string[] = [];
  let current: { head: string; lines: string[] } | null = null;
  const close = () => {
    if (current)
      found.push({ key: keyOf(current.head), text: current.lines.join("\n") });
    current = null;
  };
  lines.forEach((line, n) => {
    const starts =
      !continued[n] &&
      line.length > 0 &&
      !/^\s/.test(line) &&
      !line.startsWith("#");
    if (!starts) {
      // Comments and blank lines in column 0 lead the next chunk; indented lines continue this one.
      if (!continued[n] && (line.trim() === "" || line.startsWith("#")))
        pending.push(line);
      else if (current) current.lines.push(...pending.splice(0), line);
      else pending.push(line);
      return;
    }
    if (line.startsWith("@")) {
      close();
      pending.push(line);
      return;
    }
    close();
    current = { head: line, lines: [...pending.splice(0), line] };
  });
  close();
  if (pending.some((l) => l.trim()))
    found.push({ key: "shared", text: pending.join("\n") });
  return found.map((c) => ({ key: c.key, text: normalize(c.text) }));
}

function joined(list: Chunk[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of list) {
    const prior = map.get(c.key);
    map.set(c.key, prior === undefined ? c.text : `${prior}\n\n${c.text}`);
  }
  return map;
}

/** The source with the steps section replaced by a placeholder, so build() compares outside it. */
function withoutSection(source: string): string {
  try {
    const { start, end } = readSteps(source);
    return source.slice(0, start) + SECTION + source.slice(end);
  } catch (error) {
    if (error instanceof AppError) return source;
    throw error;
  }
}

function baseState(map: Map<string, string>): SourceChange["base"] {
  const text = map.get("base");
  if (text === undefined) return "missing";
  const body = text
    .split("\n")
    .filter((l) => /^\s/.test(l))
    .join("\n")
    .replace(/("""|''')[\s\S]*?\1/g, "")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
  return body.length === 1 && body[0] === "return None" ? "empty" : "code";
}

function fnRefs(value: StepValue, into: Set<string>) {
  if (Array.isArray(value)) value.forEach((v) => fnRefs(v, into));
  else if (value && typeof value === "object") {
    if ("fn" in value && typeof value.fn === "string") into.add(value.fn);
    else Object.values(value).forEach((v) => fnRefs(v as StepValue, into));
  }
}

/**
 * Names kept in a maximum-weight common subsequence, where names the caller may move weigh less,
 * so an ambiguous swap is attributed to them rather than to their neighbours.
 */
function keptInOrder(a: string[], b: string[], movable: Set<string>) {
  const w = (name: string) => (movable.has(name) ? 1 : 1000);
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? w(a[i]) + dp[i + 1][j + 1]
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const kept = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j] && dp[i][j] === w(a[i]) + dp[i + 1][j + 1]) {
      kept.add(a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return kept;
}

/**
 * Compares two model sources by layer ownership. `before === null` reports every layer as added.
 * `movable` names layers the caller would rather see reported as moved when a reorder is ambiguous.
 */
export function compareSources(
  before: string | null,
  after: string,
  movable: Set<string> = new Set(),
): SourceChange {
  const afterSteps = stepsOf(after);
  const beforeSteps = before === null ? [] : (stepsOf(before) ?? []);
  const steps = afterSteps ?? [];
  const afterChunks = joined(chunks(withoutSection(after)));
  const beforeChunks = joined(
    before === null ? [] : chunks(withoutSection(before)),
  );
  const beforeByName = new Map(beforeSteps.map((s) => [s.name, s]));
  const afterByName = new Map(steps.map((s) => [s.name, s]));

  const added = steps
    .filter((s) => !beforeByName.has(s.name))
    .map((s) => s.name);
  const removed = beforeSteps
    .filter((s) => !afterByName.has(s.name))
    .map((s) => s.name);
  const edited = new Set(
    steps
      .filter((s) => {
        const prior = beforeByName.get(s.name);
        return prior && prior.raw?.key !== s.raw?.key;
      })
      .map((s) => s.name),
  );

  let params = false;
  let shared = false;
  if (before !== null) {
    const callers = (fn: string) =>
      [...beforeSteps, ...steps].filter((s) => {
        const refs = new Set<string>();
        fnRefs(s.inputs, refs);
        return refs.has(fn);
      });
    const keys = new Set([...beforeChunks.keys(), ...afterChunks.keys()]);
    for (const key of keys) {
      if (beforeChunks.get(key) === afterChunks.get(key)) continue;
      if (key === "params") params = true;
      else if (key.startsWith("fn:")) {
        const users = callers(key.slice(3));
        if (!users.length) shared = true;
        for (const s of users)
          if (beforeByName.has(s.name) && afterByName.has(s.name))
            edited.add(s.name);
      } else shared = true;
    }
  }

  const common = (list: Step[], other: Map<string, Step>) =>
    list.filter((s) => other.has(s.name)).map((s) => s.name);
  const a = common(beforeSteps, afterByName);
  const b = common(steps, beforeByName);
  const kept = keptInOrder(a, b, movable);
  const moved = b.filter((name) => !kept.has(name));

  return {
    layout: afterSteps !== null,
    base: baseState(afterChunks),
    added,
    removed,
    edited: steps.filter((s) => edited.has(s.name)).map((s) => s.name),
    moved,
    params,
    shared,
  };
}
