import { AppError } from "./core";

/** Finds the `PARAMS = { ... }` literal, skipping strings and comments when matching braces. */
function paramsBlock(source: string): { start: number; end: number } {
  const heads = [...source.matchAll(/^PARAMS\s*(?::[^=\n]+)?=\s*\{/gm)];
  if (heads.length !== 1)
    throw new AppError(400, "The model has no single top-level PARAMS literal");
  const start = heads[0].index + heads[0][0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "#") {
      const next = source.indexOf("\n", i);
      i = next === -1 ? source.length : next;
    } else if (ch === '"' || ch === "'") {
      for (i++; i < source.length && source[i] !== ch; i++)
        if (source[i] === "\\") i++;
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return { start, end: i + 1 };
  }
  throw new AppError(400, "PARAMS literal is not closed");
}

/** Keeps the literal's style: an integer like 7 stays an integer, 68.0 stays a float. */
function formatNumber(value: number, previous: string) {
  if (!Number.isInteger(value)) return String(+value.toFixed(4));
  return /^-?\d+$/.test(previous) ? String(value) : value.toFixed(1);
}

/**
 * Replaces one parameter's numeric `value` inside PARAMS and nothing else. Refuses when the
 * entry or its value literal cannot be located exactly once, so an edit never guesses.
 */
export function setParameter(source: string, name: string, value: number) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))
    throw new AppError(400, "Invalid parameter name");
  if (!Number.isFinite(value))
    throw new AppError(400, "Value must be a number");
  const { start, end } = paramsBlock(source);
  const block = source.slice(start, end);
  const entry = new RegExp(`(["'])${name}\\1\\s*:\\s*\\{([^{}]*)\\}`, "g");
  const entries = [...block.matchAll(entry)];
  if (entries.length !== 1)
    throw new AppError(
      400,
      `Parameter ${name} was not found exactly once in PARAMS`,
    );
  const body = entries[0][2];
  // The number must be the whole value: `"value": 2 * 34` is computed, not editable.
  const literal =
    /(["'])value\1\s*:\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?=\s*(?:,|$))/g;
  const values = [...body.matchAll(literal)];
  if (values.length !== 1)
    throw new AppError(
      400,
      `Parameter ${name} has no plain numeric value to edit; ask the agent to change it`,
    );
  const bodyStart = start + entries[0].index + entries[0][0].indexOf("{") + 1;
  const numberStart =
    bodyStart + values[0].index + values[0][0].length - values[0][2].length;
  return (
    source.slice(0, numberStart) +
    formatNumber(value, values[0][2]) +
    source.slice(numberStart + values[0][2].length)
  );
}
