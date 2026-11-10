/* The six phases of a project and the rules between them: brief progress and versions,
   approvals, and what turns stale when something upstream changes. Pure; the UI and the
   store build on it. People approve; nothing here approves on anyone's behalf. */

export type PhaseId =
  "brief" | "art" | "concepts" | "model" | "documents" | "manufacture";
export const PHASES: { id: PhaseId; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "art", label: "Art" },
  { id: "concepts", label: "Concepts" },
  { id: "model", label: "Model" },
  { id: "documents", label: "Documents" },
  { id: "manufacture", label: "Manufacture" },
];

export type Approval = { by: string; at: string };
export type FieldState = "answered" | "assumed" | "open" | "na";
export type FieldSource = "you" | "agent" | "file";
export type BriefField = {
  key: string;
  section: string;
  label: string;
  required: boolean;
  value: string;
  state: FieldState;
  source: FieldSource;
  /** Where a value came from, e.g. the file name. */
  note?: string;
  hint?: string;
};
export type BriefFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  field: string;
  /** The stored file (/api/phase-files/<id>). */
  url?: string;
  /** An inline copy, from before files were stored on the server; imported once. */
  dataUrl?: string;
};
export type Brief = {
  version: number;
  fields: BriefField[];
  files: BriefFile[];
  approved?: Approval & { version: number; fields: BriefField[] };
};
export type Concept = {
  id: string;
  name: string;
  /** Rough W × D × H, e.g. "≈ 210 × 84 × 196 mm". */
  size: string;
  materials: string;
  components: string;
  notes: string;
  image?: string;
  /** The concept's MantelMesh model (/api/phase-files/<id>), when it has one. */
  mesh?: string;
  starred: boolean;
  discarded: boolean;
  createdAt: string;
};
export type Question = {
  id: string;
  text: string;
  owner: "client" | "maker" | "model";
  resolved?: Approval;
};
export type ConceptDecision = Approval & {
  conceptId: string;
  qualities: { label: string; value: string; approved: boolean }[];
  targets: string;
  questions: Question[];
  briefVersion: number;
};
export type DocKind =
  | "proof"
  | "drawings"
  | "parts"
  | "assembly"
  | "files"
  | "inspection"
  | "revisions";
export const DOCS: { kind: DocKind; title: string }[] = [
  { kind: "proof", title: "Customer proof" },
  { kind: "drawings", title: "Part drawings" },
  { kind: "parts", title: "Parts list" },
  { kind: "assembly", title: "Assembly instructions" },
  { kind: "files", title: "Manufacturing files" },
  { kind: "inspection", title: "Inspection checklist" },
  { kind: "revisions", title: "Revision summary" },
];
export type Stamp = Approval & { revision: number; briefVersion: number };
export type DocState = { kind: DocKind; content: string; approved?: Stamp };
export type Message = {
  id: string;
  from: "us" | "them";
  text: string;
  at: string;
};
export type Supplier = {
  id: string;
  name: string;
  scope: string;
  quote?: { price: string; lead: string };
  messages: Message[];
};
export const ORDER_STAGES = [
  "Ordered",
  "Sample",
  "Sample approved",
  "In production",
  "Shipped",
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];
export const ART_KINDS = [
  "logo",
  "lettering",
  "illustration",
  "other",
] as const;
export type ArtKind = (typeof ART_KINDS)[number];
/** The Art phase: artwork made in MantelArt and kept as the project's "art" files. */
export type Art = {
  /** What each piece of artwork is, by file name. */
  kinds: Record<string, ArtKind>;
  /** The artwork a person approved for production: the file versions, against a brief. */
  approved?: Approval & { files: string[]; briefVersion: number };
};
export type PhaseState = {
  brief: Brief;
  art: Art;
  concepts: Concept[];
  decision?: ConceptDecision;
  modelReady?: Stamp;
  docs: Record<DocKind, DocState>;
  release?: Stamp;
  suppliers: Supplier[];
  order?: Approval & { supplierId: string; stage: OrderStage };
};

type Template = [string, string, boolean, string?];
/** The spec's brief sections; [key, label, required, hint]. */
export const BRIEF_SECTIONS: { section: string; fields: Template[] }[] = [
  {
    section: "Occasion",
    fields: [
      ["deal", "Deal", true, "Who acquired or financed whom"],
      ["parties", "Parties", false],
      ["date", "Closing date", true],
      ["recipients", "Recipients", false, "Who receives one"],
      ["quantity", "Quantity", true],
      ["story", "The story", false, "What the toy should say about the deal"],
    ],
  },
  {
    section: "Commercials",
    fields: [
      ["budget", "Budget", true, "Per unit and in total"],
      ["deadline", "In hand by", true],
      ["delivery", "Delivery", false, "Address or event"],
      ["rush", "Rush allowed", false],
    ],
  },
  {
    section: "Artwork",
    fields: [
      ["logos", "Logos", true, "Attach vector files (.svg, .eps, .ai, .pdf)"],
      ["lettering", "Lettering", false, "Exact wording and where it goes"],
      ["colours", "Colours", false, "Pantone or brand references"],
      ["placement", "Placement", false],
    ],
  },
  {
    section: "Size",
    fields: [
      ["envelope", "Envelope", true, "Max W × D × H in mm"],
      ["weight", "Weight", false],
      ["footprint", "Desk footprint", false],
    ],
  },
  {
    section: "Materials and finish",
    fields: [
      ["primary", "Primary material", true],
      ["secondary", "Secondary materials", false],
      ["finish", "Finish", true],
      ["embeds", "Embedded objects", false],
    ],
  },
  {
    section: "Form and features",
    fields: [
      ["subject", "Subject", true, "Bridge, tower, tombstone, …"],
      ["adjustability", "Adjustability", false, "Moving parts, if any"],
      ["assembly", "Assembly look", true, "Seamless, visible fasteners, …"],
    ],
  },
  {
    section: "Constraints",
    fields: [
      ["fragile", "Fragile details", true],
      ["minfeature", "Minimum feature size", false],
      ["avoid", "Things to avoid", false, "Brand or regulatory rules"],
    ],
  },
  {
    section: "Packaging",
    fields: [
      ["box", "Box", true],
      ["presentation", "Presentation", false, "Insert, sleeve, card"],
    ],
  },
  { section: "Notes", fields: [["notes", "Notes", false]] },
];

export function briefTemplate(): BriefField[] {
  return BRIEF_SECTIONS.flatMap(({ section, fields }) =>
    fields.map(([key, label, required, hint]) => ({
      key,
      section,
      label,
      required,
      hint,
      value: "",
      state: "open" as const,
      source: "you" as const,
    })),
  );
}

export function emptyPhaseState(): PhaseState {
  const docs = {} as Record<DocKind, DocState>;
  for (const d of DOCS) docs[d.kind] = { kind: d.kind, content: "" };
  return {
    brief: { version: 1, fields: briefTemplate(), files: [] },
    art: { kinds: {} },
    concepts: [],
    docs,
    suppliers: [],
  };
}

export function briefProgress(b: Brief) {
  const required = b.fields.filter((f) => f.required);
  return {
    required: required.length,
    answered: required.filter((f) => f.state === "answered" || f.state === "na")
      .length,
    assumed: b.fields.filter((f) => f.state === "assumed").map((f) => f.label),
    open: required.filter((f) => f.state === "open").map((f) => f.label),
  };
}

export function approvedBriefVersion(s: PhaseState): number {
  return s.brief.approved?.version ?? 0;
}

/** Edits a field. The first edit after an approval opens the next version. */
export function editBriefField(
  s: PhaseState,
  key: string,
  patch: Partial<Pick<BriefField, "value" | "state" | "source" | "note">>,
): PhaseState {
  const fields = s.brief.fields.map((f) => {
    if (f.key !== key) return f;
    const next = { ...f, ...patch };
    if (patch.value !== undefined && patch.state === undefined)
      next.state = patch.value.trim() ? "answered" : "open";
    if (patch.value !== undefined && patch.source === undefined) {
      next.source = "you";
      next.note = undefined;
    }
    return next;
  });
  const approved = s.brief.approved;
  const version =
    approved && s.brief.version === approved.version
      ? approved.version + 1
      : s.brief.version;
  return { ...s, brief: { ...s.brief, fields, version } };
}

export function approveBrief(
  s: PhaseState,
  by: string,
  at: string,
): PhaseState {
  const { open } = briefProgress(s.brief);
  if (open.length) throw new Error(`Still open: ${open.join(", ")}`);
  return {
    ...s,
    brief: {
      ...s.brief,
      approved: {
        version: s.brief.version,
        fields: s.brief.fields.map((f) => ({ ...f })),
        by,
        at,
      },
    },
  };
}

/** Labels of fields whose value or state differs from the approved version. */
export function briefChanges(s: PhaseState): string[] {
  const a = s.brief.approved;
  if (!a || a.version === s.brief.version) return [];
  return s.brief.fields
    .filter((f) => {
      const was = a.fields.find((x) => x.key === f.key);
      return !was || was.value !== f.value || was.state !== f.state;
    })
    .map((f) => f.label);
}

export type PhaseStatus = "none" | "active" | "approved" | "stale";
function stampStale(st: Stamp, latestRevision: number, brief: number) {
  return st.revision < latestRevision || st.briefVersion < brief;
}

export function phaseStatus(
  s: PhaseState,
  phase: PhaseId,
  latestRevision: number,
): PhaseStatus {
  const bv = approvedBriefVersion(s);
  switch (phase) {
    case "brief":
      return s.brief.approved && s.brief.version === s.brief.approved.version
        ? "approved"
        : "active";
    case "art":
      if (s.art.approved)
        return s.art.approved.briefVersion < bv ? "stale" : "approved";
      return Object.keys(s.art.kinds).length ? "active" : "none";
    case "concepts":
      if (s.decision)
        return s.decision.briefVersion < bv ? "stale" : "approved";
      return s.concepts.length ? "active" : "none";
    case "model":
      if (s.modelReady)
        return stampStale(s.modelReady, latestRevision, bv)
          ? "stale"
          : "approved";
      return latestRevision > 0 ? "active" : "none";
    case "documents":
      if (s.release)
        return stampStale(s.release, latestRevision, bv) ? "stale" : "approved";
      return DOCS.some((d) => s.docs[d.kind].content || s.docs[d.kind].approved)
        ? "active"
        : "none";
    case "manufacture":
      if (s.order) return s.order.stage === "Shipped" ? "approved" : "active";
      return s.suppliers.length ? "active" : "none";
  }
}

function dims(text: string): [number, number, number] | null {
  const n = text.match(/\d+(?:\.\d+)?/g);
  if (!n || n.length < 3) return null;
  return [Number(n[0]), Number(n[1]), Number(n[2])];
}

/** Light warnings from the approved brief (or the draft if none is approved). */
export function conceptWarnings(c: Concept, s: PhaseState): string[] {
  const fields = s.brief.approved?.fields ?? s.brief.fields;
  const env = dims(fields.find((f) => f.key === "envelope")?.value ?? "");
  const size = dims(c.size);
  if (!env || !size) return [];
  const v = s.brief.approved?.version ?? s.brief.version;
  const label = `the ${env.join(" × ")} mm envelope (brief v${v})`;
  return (["Wider", "Deeper", "Taller"] as const)
    .filter((_, i) => size[i] > env[i])
    .map((w) => `${w} than ${label}`);
}

export type DocStatus = "empty" | "draft" | "approved" | "stale";
export function docStatus(
  d: DocState,
  latestRevision: number,
  briefVersion: number,
): DocStatus {
  if (d.approved)
    return stampStale(d.approved, latestRevision, briefVersion)
      ? "stale"
      : "approved";
  return d.content ? "draft" : "empty";
}

export function releaseReady(s: PhaseState, latestRevision: number) {
  if (!latestRevision)
    return { ready: false, reasons: ["No model revision yet"] };
  const bv = approvedBriefVersion(s);
  const reasons: string[] = [];
  if (!s.modelReady || stampStale(s.modelReady, latestRevision, bv))
    reasons.push(`Model r${latestRevision} is not marked ready`);
  for (const d of DOCS) {
    const st = docStatus(s.docs[d.kind], latestRevision, bv);
    if (st === "stale") reasons.push(`Stale: ${d.title}`);
    else if (st !== "approved") reasons.push(`Not approved: ${d.title}`);
  }
  return { ready: reasons.length === 0, reasons };
}

/** What the agent panel says on opening a phase. Suggestions are things to ask, never approvals. */
export function agentGuide(
  s: PhaseState,
  phase: PhaseId,
  latestRevision: number,
): { text: string; suggestions: string[] } {
  const bv = approvedBriefVersion(s);
  switch (phase) {
    case "brief": {
      const p = briefProgress(s.brief);
      const first = s.brief.fields.find(
        (f) => f.required && f.state === "open",
      );
      if (first)
        return {
          text: `${p.open.length} required ${p.open.length === 1 ? "field" : "fields"} left. Shall we start with ${first.label}?${first.hint ? ` (${first.hint}.)` : ""}`,
          suggestions: [
            `Help me fill in ${first.label}`,
            "Read an attached file",
          ],
        };
      if (phaseStatus(s, "brief", latestRevision) === "approved")
        return {
          text: `Brief v${s.brief.version} is approved. Concepts is next.`,
          suggestions: ["Go to Concepts"],
        };
      return {
        text: `Every required field has an answer${p.assumed.length ? `, with ${p.assumed.length} assumed` : ""}. The brief is ready for your approval.`,
        suggestions: p.assumed.length
          ? [`Review the assumed fields`]
          : ["Go to Concepts"],
      };
    }
    case "art": {
      const pieces = Object.keys(s.art.kinds).length;
      if (phaseStatus(s, "art", latestRevision) === "stale")
        return {
          text: `The brief changed to v${bv} after the artwork was approved. Check it still matches, then approve again.`,
          suggestions: ["What changed in the brief?"],
        };
      if (s.art.approved)
        return {
          text: "The artwork is approved. Concepts is next.",
          suggestions: ["Go to Concepts"],
        };
      if (!pieces)
        return {
          text: "Draw or redraw the logos and lettering in MantelArt. Vector artwork here is what gets engraved or printed.",
          suggestions: ["New artwork"],
        };
      return {
        text: `${pieces} ${pieces === 1 ? "piece" : "pieces"} of artwork. Mark what each one is, send finished logos to the brief, then approve the set.`,
        suggestions: [],
      };
    }
    case "concepts": {
      const live = s.concepts.filter((c) => !c.discarded);
      if (phaseStatus(s, "concepts", latestRevision) === "stale")
        return {
          text: `The brief changed to v${bv} after you chose a concept. Check that the choice still holds, then choose again.`,
          suggestions: ["What changed in the brief?"],
        };
      if (s.decision)
        return {
          text: "A concept is chosen. Model is next; its open questions follow it there.",
          suggestions: ["Go to Model"],
        };
      if (!live.length)
        return {
          text: "Throw up a few rough directions: a sketch, a reference photo or a quick description. Nothing here is permanent.",
          suggestions: ["Add a concept", "Sketch one"],
        };
      return {
        text: `${live.length} ${live.length === 1 ? "concept" : "concepts"} on the board. Star the ones worth keeping, then choose one to model.`,
        suggestions: ["Compare the starred ones"],
      };
    }
    case "model":
      return {
        text: latestRevision
          ? `Revision r${latestRevision} is the latest.`
          : "No model yet. Pick a tool or connect an agent to start.",
        suggestions: [],
      };
    case "documents": {
      const r = releaseReady(s, latestRevision);
      if (r.ready)
        return {
          text: `Every document is approved on r${latestRevision}. The release is ready for you to create.`,
          suggestions: [],
        };
      return {
        text: r.reasons.length
          ? `Before a release: ${r.reasons.slice(0, 3).join("; ")}${r.reasons.length > 3 ? "; …" : ""}.`
          : "",
        suggestions: ["Draft the assembly instructions"],
      };
    }
    case "manufacture":
      if (!s.release)
        return {
          text: "There is no release yet. Quotes should go out with an approved release so every supplier sees the same revision.",
          suggestions: ["Go to Documents"],
        };
      return {
        text: s.suppliers.length
          ? `${s.suppliers.length} ${s.suppliers.length === 1 ? "supplier" : "suppliers"} on this release. You send every message.`
          : "Add the suppliers you want quotes from.",
        suggestions: [],
      };
  }
}

const VECTOR_NAME = /\.(svg|eps|ai|pdf)$/i;
/** Adds a file to the brief's logos and updates the Logos field from the logo files. */
export function withBriefLogo(s: PhaseState, file: BriefFile): PhaseState {
  const files = [...s.brief.files.filter((f) => f.id !== file.id), file];
  const logos = files.filter((f) => f.field === "logos");
  const next = { ...s, brief: { ...s.brief, files } };
  return editBriefField(next, "logos", {
    value: logos.map((f) => f.name).join(", "),
    state: logos.some((f) => VECTOR_NAME.test(f.name)) ? "answered" : "open",
    source: "file",
    note: `${logos.length} ${logos.length === 1 ? "file" : "files"}`,
  });
}

/**
 * A MantelMesh save in the Concepts phase: a .mmesh becomes the concept's model, a .png its
 * picture. It goes to the concept it was opened from, else the one named like the file, else a
 * new concept.
 */
export function withConceptSave(
  s: PhaseState,
  file: { name: string; url: string },
  conceptId?: string,
): PhaseState {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "mmesh" && ext !== "png") return s;
  const base = file.name.replace(/\.[^.]+$/, "");
  const target =
    s.concepts.find((c) => c.id === conceptId) ??
    s.concepts.find((c) => c.name === base && !c.discarded);
  const patch = ext === "mmesh" ? { mesh: file.url } : { image: file.url };
  if (target)
    return {
      ...s,
      concepts: s.concepts.map((c) =>
        c.id === target.id ? { ...c, ...patch } : c,
      ),
    };
  return {
    ...s,
    concepts: [
      ...s.concepts,
      {
        id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: base,
        size: "",
        materials: "",
        components: "",
        notes: "",
        starred: false,
        discarded: false,
        createdAt: new Date().toISOString(),
        ...patch,
      },
    ],
  };
}
