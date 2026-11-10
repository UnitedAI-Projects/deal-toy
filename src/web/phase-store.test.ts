import { describe, expect, it } from "vitest";
import { editBriefField, emptyPhaseState } from "./phases";
import { loadPhases, savePhases } from "./phase-store";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("phase store", () => {
  it("round-trips a project's state under its own key", () => {
    const store = memory();
    const s = editBriefField(emptyPhaseState(), "deal", { value: "A buys B" });
    expect(savePhases("p1", s, store)).toEqual({ ok: true });
    expect(store.getItem("mantel.phases.v1.p1")).toBeTruthy();
    expect(loadPhases("p1", store).brief.fields[0].value).toBe("A buys B");
    expect(loadPhases("p2", store).brief.fields[0].value).toBe("");
  });

  it("reports a failed save instead of throwing", () => {
    const store = memory();
    store.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const r = savePhases("p1", emptyPhaseState(), store);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("QuotaExceededError");
  });

  it("falls back to an empty state on unreadable or missing storage", () => {
    const store = memory();
    store.setItem("mantel.phases.v1.p1", "{not json");
    expect(loadPhases("p1", store).brief.version).toBe(1);
    expect(loadPhases("p1", undefined).brief.version).toBe(1);
  });

  it("fills in fields added to the template after a save", () => {
    const store = memory();
    const s = emptyPhaseState();
    s.brief.fields = s.brief.fields.slice(0, 2);
    savePhases("p1", s, store);
    expect(loadPhases("p1", store).brief.fields.length).toBe(
      emptyPhaseState().brief.fields.length,
    );
  });
});
