import { describe, expect, it } from "vitest";
import { actions, catalogIndex, getAction, stepStates } from "./catalog";

type Schema = Record<string, unknown>;
/** Every nested schema in an action's inputs, with a path for failure messages. */
function walk(
  schema: Schema,
  path: string,
  visit: (s: Schema, p: string) => void,
) {
  visit(schema, path);
  const props = (schema.properties ?? {}) as Record<string, Schema>;
  for (const [k, v] of Object.entries(props)) walk(v, `${path}.${k}`, visit);
  if (schema.items) walk(schema.items as Schema, `${path}[]`, visit);
  for (const [i, branch] of ((schema.oneOf ?? []) as Schema[]).entries())
    walk(branch, `${path}|${i}`, visit);
}

describe("action catalog", () => {
  it("has the built-in actions, custom last", () => {
    expect(actions.map((a) => a.id)).toEqual([
      "body",
      "plane",
      "extrude",
      "hole",
      "fillet",
      "chamfer",
      "text",
      "combine",
      "move",
      "revolve",
      "loft",
      "sweep",
      "shell",
      "custom",
    ]);
  });
  it("describes every input", () => {
    for (const action of actions)
      for (const [name, prop] of Object.entries(
        action.inputs.properties as Record<string, Schema>,
      ))
        walk(prop, `${action.id}.${name}`, (s, p) => {
          if (s.const !== undefined) return;
          expect(s.description, p).toEqual(expect.stringMatching(/\S/));
          if (s.type === "number") {
            expect(s.unit, p).toEqual(expect.stringMatching(/\S/));
            expect(typeof s.minimum, p).toBe("number");
            expect(typeof s.maximum, p).toBe("number");
          }
        });
  });
  it("keeps summaries short", () => {
    for (const a of actions)
      expect(a.summary.length, a.id).toBeLessThanOrEqual(120);
  });
  it("names failures", () => {
    for (const a of actions) {
      expect(a.failures.length, a.id).toBeGreaterThan(0);
      for (const f of a.failures) expect(f.code).toMatch(/^[a-z_]+$/);
      if (a.selections.some((s) => s.kind === "face" || s.kind === "edge")) {
        const codes = a.failures.map((f) => f.code);
        expect(codes, a.id).toContain("face_not_found");
        expect(codes, a.id).toContain("ambiguous_reference");
      }
    }
  });
  it("lists the step states", () => {
    expect(stepStates.map((s) => s.state)).toEqual([
      "ok",
      "warning",
      "failed",
      "blocked",
      "suppressed",
      "pending",
    ]);
  });
  it("indexes the catalog", () => {
    const lines = catalogIndex().split("\n");
    expect(lines).toHaveLength(14);
    expect(lines[3]).toBe(`hole@1: ${getAction("hole").summary}`);
  });
  it("refuses unknown actions", () => {
    expect(() => getAction("teleport")).toThrow("Unknown action teleport");
  });
});
