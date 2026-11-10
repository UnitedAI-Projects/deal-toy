import { describe, expect, it } from "vitest";
import {
  agentGuide,
  approveBrief,
  approvedBriefVersion,
  briefChanges,
  briefProgress,
  conceptWarnings,
  docStatus,
  editBriefField,
  emptyPhaseState,
  phaseStatus,
  releaseReady,
  withBriefLogo,
  DOCS,
  type Concept,
  type PhaseState,
} from "./phases";

const at = "2026-11-10T12:00:00.000Z";
const by = "owner@example.com";

/** Every required field answered. */
function complete(s = emptyPhaseState()): PhaseState {
  let next = s;
  for (const f of s.brief.fields)
    if (f.required) next = editBriefField(next, f.key, { value: "x" });
  return next;
}

const concept = (size: string): Concept => ({
  id: "c1",
  name: "B",
  size,
  materials: "",
  components: "",
  notes: "",
  starred: false,
  discarded: false,
  createdAt: at,
});

describe("brief", () => {
  it("starts at v1 with the spec's 13 required fields open", () => {
    const s = emptyPhaseState();
    expect(s.brief.version).toBe(1);
    const p = briefProgress(s.brief);
    expect(p.required).toBe(13);
    expect(p.answered).toBe(0);
    expect(p.open).toContain("Logos");
    expect(p.open).toContain("Box");
  });

  it("refuses approval naming the open required fields", () => {
    let s = complete();
    s = editBriefField(s, "logos", { value: "", state: "open" });
    s = editBriefField(s, "box", { value: "", state: "open" });
    expect(() => approveBrief(s, by, at)).toThrow("Still open: Logos, Box");
  });

  it("approves when nothing required is open, counting assumptions", () => {
    let s = complete();
    s = editBriefField(s, "weight", { value: "600 g", state: "assumed" });
    expect(briefProgress(s.brief).assumed).toEqual(["Weight"]);
    const a = approveBrief(s, by, at);
    expect(a.brief.approved).toMatchObject({ version: 1, by, at });
    expect(approvedBriefVersion(a)).toBe(1);
  });

  it("opens v2 on the first edit after approval and stays there", () => {
    let s = approveBrief(complete(), by, at);
    s = editBriefField(s, "envelope", { value: "220 × 90 × 200" });
    s = editBriefField(s, "envelope", { value: "220 × 90 × 210" });
    expect(s.brief.version).toBe(2);
    expect(approvedBriefVersion(s)).toBe(1);
    expect(briefChanges(s)).toEqual(["Envelope"]);
  });

  it("marks an edited value as answered by you", () => {
    const s = editBriefField(emptyPhaseState(), "deal", { value: "A buys B" });
    const f = s.brief.fields.find((x) => x.key === "deal")!;
    expect(f).toMatchObject({ state: "answered", source: "you" });
  });
});

describe("phaseStatus", () => {
  it("is none for a new project", () => {
    const s = emptyPhaseState();
    for (const p of ["concepts", "model", "documents", "manufacture"] as const)
      expect(phaseStatus(s, p, 0)).toBe("none");
    expect(phaseStatus(s, "brief", 0)).toBe("active");
  });

  it("turns concepts stale only after a newer brief is approved", () => {
    let s = approveBrief(complete(), by, at);
    s = {
      ...s,
      concepts: [concept("1 × 1 × 1")],
      decision: {
        conceptId: "c1",
        qualities: [],
        targets: "",
        questions: [],
        briefVersion: 1,
        by,
        at,
      },
    };
    expect(phaseStatus(s, "concepts", 0)).toBe("approved");
    s = editBriefField(s, "box", { value: "walnut box" });
    expect(phaseStatus(s, "concepts", 0)).toBe("approved");
    expect(phaseStatus(s, "brief", 0)).toBe("active");
    s = approveBrief(s, by, at);
    expect(phaseStatus(s, "concepts", 0)).toBe("stale");
  });

  it("turns model stale when a later revision exists", () => {
    const s = {
      ...emptyPhaseState(),
      modelReady: { revision: 6, briefVersion: 0, by, at },
    };
    expect(phaseStatus(s, "model", 6)).toBe("approved");
    expect(phaseStatus(s, "model", 7)).toBe("stale");
    expect(phaseStatus(emptyPhaseState(), "model", 3)).toBe("active");
  });
});

describe("art", () => {
  it("is none until there is artwork, then active, approved and stale", () => {
    let s = emptyPhaseState();
    expect(phaseStatus(s, "art", 0)).toBe("none");
    s = { ...s, art: { kinds: { "logo.svg": "logo" } } };
    expect(phaseStatus(s, "art", 0)).toBe("active");
    s = approveBrief(complete(s), by, at);
    s = {
      ...s,
      art: { ...s.art, approved: { files: ["f1"], briefVersion: 1, by, at } },
    };
    expect(phaseStatus(s, "art", 0)).toBe("approved");
    s = approveBrief(editBriefField(s, "box", { value: "walnut box" }), by, at);
    expect(phaseStatus(s, "art", 0)).toBe("stale");
  });

  it("sends a file to the brief's logos and answers the field", () => {
    const s = withBriefLogo(emptyPhaseState(), {
      id: "f1",
      name: "harbor.svg",
      type: "image/svg+xml",
      size: 10,
      field: "logos",
      url: "/api/phase-files/f1",
    });
    expect(s.brief.files.map((f) => f.id)).toEqual(["f1"]);
    expect(s.brief.fields.find((f) => f.key === "logos")).toMatchObject({
      value: "harbor.svg",
      state: "answered",
      source: "file",
    });
    // Sending it again doesn't add it twice.
    expect(withBriefLogo(s, s.brief.files[0]).brief.files).toHaveLength(1);
  });
});

describe("conceptWarnings", () => {
  const withEnvelope = (v: string) =>
    approveBrief(editBriefField(complete(), "envelope", { value: v }), by, at);

  it("warns per dimension the concept exceeds", () => {
    const s = withEnvelope("220 × 90 × 180 mm max");
    expect(conceptWarnings(concept("≈ 210 × 84 × 196 mm"), s)).toEqual([
      "Taller than the 220 × 90 × 180 mm envelope (brief v1)",
    ]);
  });

  it("reads 'x' separators", () => {
    const s = withEnvelope("220x90x200");
    expect(conceptWarnings(concept("230x95x100"), s)).toEqual([
      "Wider than the 220 × 90 × 200 mm envelope (brief v1)",
      "Deeper than the 220 × 90 × 200 mm envelope (brief v1)",
    ]);
  });

  it("says nothing when either size does not parse", () => {
    expect(
      conceptWarnings(concept("tall"), withEnvelope("220x90x200")),
    ).toEqual([]);
    expect(conceptWarnings(concept("1x1x1"), emptyPhaseState())).toEqual([]);
  });
});

describe("documents and release", () => {
  it("rates a document by revision and brief version", () => {
    const d = { kind: "proof" as const, content: "" };
    expect(docStatus(d, 7, 1)).toBe("empty");
    expect(docStatus({ ...d, content: "x" }, 7, 1)).toBe("draft");
    const ok = { ...d, approved: { revision: 7, briefVersion: 1, by, at } };
    expect(docStatus(ok, 7, 1)).toBe("approved");
    expect(docStatus(ok, 8, 1)).toBe("stale");
    expect(docStatus(ok, 7, 2)).toBe("stale");
  });

  it("is not ready without a revision", () => {
    const r = releaseReady(emptyPhaseState(), 0);
    expect(r.ready).toBe(false);
    expect(r.reasons[0]).toBe("No model revision yet");
  });

  it("lists the documents still missing approval by title", () => {
    const s = emptyPhaseState();
    s.modelReady = { revision: 3, briefVersion: 0, by, at };
    s.docs.proof.approved = { revision: 3, briefVersion: 0, by, at };
    const r = releaseReady(s, 3);
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("Not approved: Part drawings");
    expect(r.reasons).not.toContain("Not approved: Customer proof");
  });

  it("is ready when the model and every document are approved on it", () => {
    const s = emptyPhaseState();
    s.modelReady = { revision: 3, briefVersion: 0, by, at };
    for (const d of DOCS)
      s.docs[d.kind].approved = { revision: 3, briefVersion: 0, by, at };
    expect(releaseReady(s, 3)).toEqual({ ready: true, reasons: [] });
  });
});

describe("agentGuide", () => {
  it("names the first open required field in Brief", () => {
    const g = agentGuide(emptyPhaseState(), "brief", 0);
    expect(g.text).toContain("Deal");
  });

  it("asks for a person to approve rather than approving", () => {
    const g = agentGuide(complete(), "brief", 0);
    expect(g.text).toMatch(/ready for your approval/i);
  });
});
