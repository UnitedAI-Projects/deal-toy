import { describe, expect, it } from "vitest";
import design from "../../examples/tea_cup_design.json";
import {
  assumedCount,
  eventLine,
  menuLabel,
  sheetRows,
  type DesignSheet,
} from "./design-sheet";

const sheet: DesignSheet = {
  modelId: "m",
  built: true,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
  ...(design as Omit<
    DesignSheet,
    "modelId" | "built" | "createdAt" | "updatedAt"
  >),
};

describe("design sheet helpers", () => {
  it("rows keep sheet order and mark assumptions", () => {
    const rows = sheetRows(sheet);
    expect(rows.map((r) => r.name)).toEqual(sheet.sections.map((s) => s.name));
    expect(rows.filter((r) => r.assumed).map((r) => r.name)).toEqual([
      "Designs",
    ]);
    expect(rows[0]).toEqual({
      name: "Overall size",
      value: "95 mm tall, 84 mm across the rim, 62 mm across the base",
      assumed: false,
    });
  });

  it("counts assumed sections", () => {
    expect(assumedCount(sheet)).toBe(1);
    const two = {
      ...sheet,
      sections: sheet.sections.map((s) => ({
        ...s,
        source: "assumed" as const,
      })),
    };
    expect(assumedCount(two)).toBe(7);
  });

  it("labels the menu entry", () => {
    expect(menuLabel(null)).toBe("No design sheet yet");
    expect(menuLabel(sheet)).toBe("Design sheet · 1 assumed");
    expect(
      menuLabel({
        ...sheet,
        sections: sheet.sections.map((s) => ({
          ...s,
          source: "answered" as const,
        })),
      }),
    ).toBe("Design sheet");
  });
});

describe("design and change events", () => {
  const event = (kind: string, payload: Record<string, unknown>) => ({
    kind,
    payload,
  });
  it("describes each event in a line", () => {
    expect(
      eventLine(
        event("design", {
          request: "A tea cup",
          framework: ["Cup wall", "Rim"],
          assumed: ["Designs"],
        }),
      ),
    ).toBe("Design sheet: A tea cup · 2 layers, 1 assumed");
    expect(
      eventLine(
        event("change", {
          type: "begin",
          request: "Make the rim oval",
          add: [],
          edit: ["Rim"],
          remove: [],
          rename: [],
          follow: ["Cup wall"],
        }),
      ),
    ).toBe("Change: Make the rim oval · edit Rim; follows Cup wall");
    expect(
      eventLine(
        event("change", {
          type: "progress",
          layer: "Rim",
          phrases: ["Stretching to 86 mm", "Keeping the lip"],
        }),
      ),
    ).toBe("Working on Rim: Stretching to 86 mm; Keeping the lip");
    expect(
      eventLine(
        event("change", { type: "finish", summary: "Oval rim.", missing: [] }),
      ),
    ).toBe("Change finished: Oval rim.");
    expect(
      eventLine(
        event("change", {
          type: "finish",
          summary: "Gave up.",
          missing: ["Saucer"],
        }),
      ),
    ).toBe("Change finished: Gave up. · not built: Saucer");
    expect(
      eventLine(event("change", { type: "stopped", reason: "inactive" })),
    ).toBe("Change stopped after 30 minutes without activity");
    expect(
      eventLine(event("change", { type: "stopped", reason: "session_ended" })),
    ).toBe("Change stopped when the session ended");
  });
  it("ignores other events", () => {
    expect(eventLine(event("tool_call", { summary: "x" }))).toBeNull();
  });
});
