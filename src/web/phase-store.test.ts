import { describe, expect, it } from "vitest";
import { editBriefField, emptyPhaseState, type PhaseState } from "./phases";
import {
  forgetLocalPhases,
  inlineImages,
  loadPhases,
  normalize,
  savePhases,
  withFileUrls,
} from "./phase-store";

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
  it("round-trips this browser's old copy under the project's key, and forgets it", () => {
    const store = memory();
    const s = editBriefField(emptyPhaseState(), "deal", { value: "A buys B" });
    expect(savePhases("p1", s, store)).toEqual({ ok: true });
    expect(loadPhases("p1", store)!.brief.fields[0].value).toBe("A buys B");
    expect(loadPhases("p2", store)).toBeNull();
    forgetLocalPhases("p1", store);
    expect(loadPhases("p1", store)).toBeNull();
  });

  it("reports a failed save instead of throwing", () => {
    const store = memory();
    store.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const r = savePhases("p1", emptyPhaseState(), store);
    expect(!r.ok && r.reason).toContain("QuotaExceededError");
  });

  it("reads unreadable or missing storage as nothing", () => {
    const store = memory();
    store.setItem("mantel.phases.v1.p1", "{not json");
    expect(loadPhases("p1", store)).toBeNull();
    expect(loadPhases("p1", undefined)).toBeNull();
  });

  it("fills in fields and documents the template gained since a save", () => {
    const s = emptyPhaseState();
    s.brief.fields = s.brief.fields.slice(0, 2);
    const n = normalize(JSON.parse(JSON.stringify(s)) as PhaseState);
    expect(n.brief.fields.length).toBe(emptyPhaseState().brief.fields.length);
    expect(normalize(null).brief.version).toBe(1);
  });

  it("finds inline images and swaps them for stored files", () => {
    const s = emptyPhaseState();
    s.brief.files = [
      {
        id: "f1",
        name: "logo.png",
        type: "image/png",
        size: 3,
        field: "logos",
        dataUrl: "data:image/png;base64,AAA",
      },
      {
        id: "f2",
        name: "logo.svg",
        type: "image/svg+xml",
        size: 3,
        field: "logos",
        url: "/api/phase-files/x",
      },
    ];
    s.concepts = [
      {
        id: "c1",
        name: "A",
        size: "",
        materials: "",
        components: "",
        notes: "",
        image: "data:image/png;base64,BBB",
        starred: false,
        discarded: false,
        createdAt: "",
      },
    ];
    const found = inlineImages(s);
    expect(found.map((f) => f.where)).toEqual(["file:f1", "concept:c1"]);
    const out = withFileUrls(
      s,
      new Map([
        ["file:f1", "/api/phase-files/1"],
        ["concept:c1", "/api/phase-files/2"],
      ]),
    );
    expect(out.brief.files[0]).toMatchObject({
      url: "/api/phase-files/1",
      dataUrl: undefined,
    });
    expect(out.brief.files[1].url).toBe("/api/phase-files/x");
    expect(out.concepts[0].image).toBe("/api/phase-files/2");
    expect(inlineImages(out)).toEqual([]);
  });
});
