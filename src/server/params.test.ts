import { describe, expect, it } from "vitest";
import { setParameter } from "./params";
const source = `import build123d as bd

# "ARCH_RISE": {"value": 1} in a comment is ignored
PARAMS = {
    "ARCH_RISE": {"value": 68.0, "unit": "mm", "part": "Arch rib", "min": 30, "max": 120},
    'RIB_T': {'value': 4, 'unit': 'mm', 'part': 'Arch rib'},
    "NOTE": {"value": 2.5, "part": "Plaque {front}"},
    "DERIVED": {"value": 2 * 34, "part": "Arch rib"},
}
ARCH_RISE = PARAMS["ARCH_RISE"]["value"]


def build():
    return bd.Box(10, 10, ARCH_RISE)
`;
describe("setParameter", () => {
  it("changes only the chosen value literal", () => {
    const next = setParameter(source, "ARCH_RISE", 78);
    expect(next).toContain(`"ARCH_RISE": {"value": 78.0, "unit": "mm"`);
    expect(next.replace("78.0", "68.0")).toBe(source);
  });
  it("keeps integer literals as integers", () => {
    expect(setParameter(source, "RIB_T", 5)).toContain(`'RIB_T': {'value': 5,`);
  });
  it("handles single quotes and decimals", () => {
    expect(setParameter(source, "RIB_T", 4.25)).toContain(
      `'RIB_T': {'value': 4.25,`,
    );
  });
  it("refuses missing, computed or ambiguous entries", () => {
    expect(() => setParameter(source, "MISSING", 1)).toThrow("not found");
    expect(() => setParameter(source, "DERIVED", 1)).toThrow("ask the agent");
    expect(() =>
      setParameter(
        `PARAMS = {"A": {"value": 1}}\nPARAMS = {"A": {"value": 2}}`,
        "A",
        3,
      ),
    ).toThrow("single top-level");
    expect(() => setParameter("x = 1", "A", 3)).toThrow("single top-level");
  });
  it("refuses unsafe names and non-finite values", () => {
    expect(() => setParameter(source, "A|B", 1)).toThrow("Invalid parameter");
    expect(() => setParameter(source, "RIB_T", Number.NaN)).toThrow("number");
  });
});
