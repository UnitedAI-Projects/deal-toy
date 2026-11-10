/** A model's design sheet as design_get returns it, and helpers for showing it. */
export type DesignSheet = {
  modelId: string;
  request: string;
  sections: { name: string; value: string; source: "answered" | "assumed" }[];
  framework: {
    name: string;
    kind: string;
    params: string[];
    region: { min: number[]; max: number[] };
  }[];
  built: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SheetRow = { name: string; value: string; assumed: boolean };

/** One row per section, in the sheet's order, with assumptions marked. */
export function sheetRows(sheet: DesignSheet): SheetRow[] {
  return sheet.sections.map((s) => ({
    name: s.name,
    value: s.value,
    assumed: s.source === "assumed",
  }));
}

export function assumedCount(sheet: DesignSheet): number {
  return sheet.sections.filter((s) => s.source === "assumed").length;
}

/** The workspace menu entry for the sheet. */
export function menuLabel(sheet: DesignSheet | null): string {
  if (!sheet) return "No design sheet yet";
  const assumed = assumedCount(sheet);
  return assumed ? `Design sheet · ${assumed} assumed` : "Design sheet";
}

const list = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String(x))) : [];

/**
 * One line for a design or change event in the activity list, or null for other events. The live
 * selector on the model that follows these events is a later part.
 */
export function eventLine(event: {
  kind: string;
  payload: Record<string, unknown>;
}): string | null {
  const p = event.payload;
  if (event.kind === "design") {
    const assumed = list(p.assumed).length;
    return `Design sheet: ${String(p.request)} · ${list(p.framework).length} layers${assumed ? `, ${assumed} assumed` : ""}`;
  }
  if (event.kind !== "change") return null;
  switch (p.type) {
    case "begin": {
      const renames = Array.isArray(p.rename)
        ? (p.rename as { from: string; to: string }[]).map(
            (r) => `${r.from} → ${r.to}`,
          )
        : [];
      const parts = [
        ["add", list(p.add)],
        ["edit", list(p.edit)],
        ["remove", list(p.remove)],
        ["rename", renames],
        ["follows", list(p.follow)],
      ]
        .filter(([, names]) => names.length)
        .map(([verb, names]) => `${verb} ${(names as string[]).join(", ")}`);
      return `Change: ${String(p.request)}${parts.length ? ` · ${parts.join("; ")}` : ""}`;
    }
    case "progress": {
      const phrases = list(p.phrases);
      return `Working on ${String(p.layer)}${phrases.length ? `: ${phrases.join("; ")}` : ""}`;
    }
    case "finish": {
      const missing = list(p.missing);
      return `Change finished: ${String(p.summary)}${missing.length ? ` · not built: ${missing.join(", ")}` : ""}`;
    }
    case "stopped":
      return p.reason === "inactive"
        ? "Change stopped after 30 minutes without activity"
        : "Change stopped when the session ended";
    default:
      return null;
  }
}
