// Seeds the SpaceX IPO demo project and its recorded walkthrough into a Mantel.
//
//   node examples/spacex-ipo/demo.mjs <app origin> <sign-in link file>
//
// The link file comes from `node ci/member.mjs --local|--remote you@example.com owner <file>`.
// Everything goes through the app's own API as that person: the project, its files, five MantelCAD
// revisions (built by the CAD container), each step's phase state, and the demo script that plays
// them back. The conversations, the Jiga quotes and the client thread are scripted: this is a
// simulated walkthrough for presentations, and nothing in it is sent to anyone.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [origin, linkFile] = process.argv.slice(2);
if (!origin || !linkFile)
  throw new Error(
    "Usage: node examples/spacex-ipo/demo.mjs <origin> <link file>",
  );
const OPUS = "claude-opus-5.5";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Signing in and calling the API -------------------------------------------------------------
const link = new URL(readFileSync(linkFile, "utf8").trim());
let cookie = "";
{
  const response = await fetch(`${origin}/api/auth/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token: link.hash.slice(1) }),
  });
  if (!response.ok) throw new Error(`Sign-in failed: ${await response.text()}`);
  cookie = response.headers.get("set-cookie").split(";")[0];
}
async function api(path, init = {}) {
  const response = await fetch(origin + path, {
    ...init,
    headers: { Origin: origin, Cookie: cookie, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const call = (name, input) =>
  api(`/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
const me = (await api("/api/session")).email;
const at = (iso) => iso; // dates in the story are written out as they happened
const upload = (projectId, phase, name, type) =>
  api(
    `/api/projects/${projectId}/phase-files?phase=${phase}&name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { "Content-Type": type },
      body: readFileSync(join(here, name.includes("/") ? name : fileFor(name))),
    },
  );
const fileFor = (name) =>
  name.endsWith(".svg")
    ? `art/${name}`
    : name.endsWith(".png")
      ? `concepts/${name}`
      : name;

// --- The project ---------------------------------------------------------------------------------
const project = await call("projects_create", {
  name: "SpaceX IPO deal toy",
  brief:
    "Commemorative deal toy for the SpaceX listing on Nasdaq: a Falcon-style booster landed on its pad, on a black hexagonal base with three plaques. Recorded demo.",
});
const projectId = project.id;
console.log("project", projectId);

const reference = await upload(
  projectId,
  "brief",
  "reference-render.jpg",
  "image/jpeg",
);
const art = {};
for (const name of [
  "rocket-lettering.svg",
  "plaque-front.svg",
  "plaque-listing.svg",
  "plaque-occasion.svg",
])
  art[name] = await upload(projectId, "art", name, "image/svg+xml");
const concepts = {};
for (const name of [
  "a-falcon-on-the-pad.png",
  "b-acrylic-tower.png",
  "c-launch-tower.png",
  "r5-front.png",
])
  concepts[name] = await upload(projectId, "concepts", name, "image/png");

// --- The model: five MantelCAD revisions, built by the CAD container -------------------------------
const model = await call("models_create", {
  projectId,
  name: "SpaceX IPO deal toy",
});
const builds = [];
for (let r = 1; r <= 5; r++) {
  const source = readFileSync(join(here, `designs/r${r}.json`), "utf8");
  const saved = await call("models_save", {
    modelId: model.id,
    expectedRevision: r - 1,
    source,
  });
  builds.push((await call("models_build", { revisionId: saved.id })).id);
  console.log(`r${r} saved, building`);
}
for (const id of builds) {
  for (let i = 0; ; i++) {
    const job = await call("builds_get", { jobId: id });
    if (job.status === "succeeded") break;
    if (job.status === "failed") throw new Error(`Build failed: ${job.error}`);
    if (i > 240) throw new Error("A build took longer than 20 minutes");
    await wait(5000);
  }
}
console.log("all five revisions built");

// --- The phase states, step by step -------------------------------------------------------------
let version = (await call("phases_get", { projectId })).version;
let state = (await call("phases_get", { projectId })).state ?? null;
const steps = [];
const template = await (async () => {
  // A fresh state's brief template, as the app makes it.
  const { emptyPhaseState } = await import("../../src/shared/phases.ts");
  return emptyPhaseState();
})();
state ??= template;
const clone = (v) => JSON.parse(JSON.stringify(v));
const field = (key) => state.brief.fields.find((f) => f.key === key);
const answer = (key, value, how = "answered", source = "agent", note) =>
  Object.assign(field(key), {
    value,
    state: how,
    source,
    ...(note ? { note } : {}),
  });
const stamp = (when) => ({ by: me, at: when });

/** Saves the state as the step leaves it, and records the step with the server's copy. */
async function step(entry, change) {
  if (change) {
    change();
    const saved = await call("phases_save", {
      projectId,
      expectedVersion: version,
      state,
    });
    version = saved.version;
    state = (await call("phases_get", { projectId })).state;
  }
  steps.push({ revision: 0, ...entry, state: clone(state) });
}

// Brief ------------------------------------------------------------------------------------------
await step(
  {
    phase: "brief",
    kind: "system",
    title: "A new project, with the client's reference render",
    caption:
      "The deal team sent a render of the toy they have in mind. It goes into the brief as a reference.",
  },
  () => {
    state.brief.files = [
      {
        id: reference.id,
        name: "reference-render.jpg",
        type: "image/jpeg",
        size: reference.size,
        field: "notes",
        url: reference.url,
      },
    ];
  },
);
await step(
  {
    phase: "brief",
    kind: "agent",
    model: OPUS,
    title: "Mantel fills in the occasion from one message",
    caption:
      "Claude Opus 5.5, running through Cloudflare AI Gateway, turns the request into brief answers and asks only what it can't infer.",
    prompt:
      "We need the deal toy for the SpaceX IPO on Nasdaq, ticker SPCX. First trade is June 12, 2026. 250 pieces for the deal team, SpaceX leadership and the syndicate. Use the attached render.",
    response:
      "I've filled in the occasion: the SpaceX IPO on Nasdaq (SPCX), first trade June 12, 2026, 250 pieces for the deal team, SpaceX leadership and the syndicate banks. From the render, the story is a Falcon booster that has landed on its pad, with the offering on the base plaques. Two things I can't infer: the budget per piece and the date you need them in hand.",
    actions: [
      { name: "brief_update", ok: true, detail: "Brief answers saved" },
    ],
    focus: ".phase-agent",
  },
  () => {
    answer("deal", "SpaceX initial public offering on Nasdaq (SPCX)");
    answer("parties", "SpaceX · underwriting syndicate");
    answer("date", "June 12, 2026 (first trade)");
    answer("recipients", "Deal team, SpaceX leadership, syndicate banks");
    answer("quantity", "250");
    answer(
      "story",
      "The listing as a landing: a Falcon booster standing on its legs on the pad, the offering on the plaques",
      "assumed",
    );
  },
);
await step(
  {
    phase: "brief",
    kind: "manual",
    title: "The designer types the budget and the date",
    caption:
      "Manual edit: budget $180 a piece, in hand by July 15, 2026, delivered to New York.",
  },
  () => {
    answer("budget", "$180 per piece · $45,000 total", "answered", "you");
    answer("deadline", "July 15, 2026", "answered", "you");
    answer("delivery", "Deal team office, New York", "answered", "you");
    answer("rush", "Yes, up to 15% over budget", "answered", "you");
  },
);
await step(
  {
    phase: "brief",
    kind: "agent",
    model: OPUS,
    title: "Artwork, size and materials, read from the render",
    caption:
      "Mantel proposes the rest of the brief from the reference. Everything it guessed is marked assumed for the designer to confirm.",
    prompt:
      "Fill in the artwork, size, materials and packaging from the render. Mark anything you're guessing.",
    response:
      "Done. Lettering reads SPACEX, NASDAQ: SPCX and IPO 2026 up the rocket, with three plaques on the front faces of the base: the offering, the listing and the occasion. Gloss white rocket, black bands and base, brushed silver plaques. I've assumed a cast-resin rocket on an aluminium base, stainless legs and a black rigid box, sized within 140 × 130 × 400 mm. The legs and grid fins are the fragile details, so I've noted them. Everything assumed is marked for you to confirm.",
    actions: [
      { name: "brief_update", ok: true, detail: "Brief answers saved" },
    ],
    focus: ".phase-agent",
  },
  () => {
    answer("logos", "SpaceX wordmark, vector from the client", "assumed");
    answer(
      "lettering",
      "Rocket: SPACEX · NASDAQ: SPCX · IPO 2026. Plaques: SPACEX / Initial public offering / $75,000,000,000 · NASDAQ / SPCX / June 12, 2026 · IPO / June 2026",
    );
    answer(
      "colours",
      "Gloss white rocket, black bands and base, brushed silver plaques",
    );
    answer(
      "placement",
      "Lettering up the rocket's front; plaques on the three front faces",
    );
    answer("envelope", "≤ 140 × 130 × 400 mm", "assumed");
    answer("weight", "≤ 1.2 kg", "assumed");
    answer("footprint", "≤ 140 mm across", "assumed");
    answer("primary", "Cast resin rocket on an aluminium base", "assumed");
    answer(
      "secondary",
      "Stainless legs, anodised aluminium plaques",
      "assumed",
    );
    answer(
      "finish",
      "Gloss white paint, black powder coat, brushed silver plaques",
    );
    answer("embeds", "None", "na");
    answer("subject", "A Falcon-style booster landed on its pad");
    answer("adjustability", "None", "na");
    answer("assembly", "Seamless; plaques bonded flush", "assumed");
    answer("fragile", "Landing legs (Ø1.6 mm) and grid fins");
    answer("minfeature", "1.6 mm stainless struts", "assumed");
    answer("avoid", "Use only client-approved logo artwork", "assumed");
    answer("box", "Black rigid box with a foam insert", "assumed");
    answer("presentation", "Card with the deal summary");
  },
);
await step(
  {
    phase: "brief",
    kind: "manual",
    title: "The designer confirms the assumptions and approves the brief",
    caption:
      "Only a person approves. The approved brief v1 is what every later phase checks against.",
  },
  () => {
    for (const f of state.brief.fields)
      if (f.state === "assumed") Object.assign(f, { state: "answered" });
    answer(
      "notes",
      "Reference render attached; client approved the direction",
      "answered",
      "you",
    );
    state.brief.approved = {
      ...stamp("2026-05-04T15:10:00.000Z"),
      version: state.brief.version,
      fields: clone(state.brief.fields),
    };
  },
);

// Art --------------------------------------------------------------------------------------------
await step(
  {
    phase: "art",
    kind: "agent",
    model: OPUS,
    title: "The lettering and plaque layouts",
    caption:
      "Mantel lays out the rocket lettering and the three plaques from the approved brief, in MantelArt.",
    prompt:
      "Prepare the artwork: the lettering up the rocket and the three plaque layouts.",
    response:
      "Four pieces are ready in MantelArt: the rocket lettering (SPACEX, NASDAQ: SPCX, IPO 2026, reading bottom to top) and the front, listing and occasion plaques, each 58 × 20 mm to fit the base faces. All text is in Liberation Sans so production can match it exactly.",
    actions: [{ name: "phases_save", ok: true, detail: "Phase changes saved" }],
    focus: ".phase-agent",
  },
  () => {
    state.art = {
      // Keyed by piece: the file name without its extension, as the Art phase groups them.
      kinds: {
        "rocket-lettering": "lettering",
        "plaque-front": "lettering",
        "plaque-listing": "lettering",
        "plaque-occasion": "lettering",
      },
    };
  },
);
await step({
  phase: "art",
  kind: "manual",
  title: "A hand edit in MantelArt",
  caption:
    "Manual change: the designer opens the front plaque in MantelArt and tightens the letter spacing on the offering size.",
});
await step(
  {
    phase: "art",
    kind: "manual",
    title: "Artwork approved",
    caption: "The four pieces are approved for production against brief v1.",
  },
  () => {
    state.art.approved = {
      ...stamp("2026-05-06T10:00:00.000Z"),
      files: Object.keys(state.art.kinds),
      briefVersion: 1,
    };
  },
);

// Concepts ---------------------------------------------------------------------------------------
const concept = (id, name, image, size, materials, components, notes) => ({
  id,
  name,
  size,
  materials,
  components,
  notes,
  image: concepts[image].url,
  starred: false,
  discarded: false,
  createdAt: "2026-05-07T09:00:00.000Z",
});
await step(
  {
    phase: "concepts",
    kind: "agent",
    model: OPUS,
    title: "Three directions, rendered in MantelCAD",
    caption:
      "Mantel proposes three concepts that fit the brief and renders each one.",
    prompt: "Give me three directions within the envelope, and render them.",
    response:
      "Three directions. A, Falcon on the pad: the booster on its legs on a landing pad, the hex base carrying the plaques; closest to the render. B, Acrylic tower: the same rocket sealed in a clear block, safer for the legs but heavier and $40 more a piece. C, Launch tower: the rocket beside a red service tower; a bigger silhouette that crowds the plaques. I'd take A.",
    actions: [{ name: "phases_save", ok: true, detail: "Phase changes saved" }],
    focus: ".phase-agent",
  },
  () => {
    state.concepts = [
      concept(
        "concept-a",
        "A · Falcon on the pad",
        "a-falcon-on-the-pad.png",
        "≈ 132 × 116 × 371 mm",
        "Resin, aluminium, stainless",
        "Rocket, 4 legs, pad, hex base, 3 plaques",
        "Closest to the reference; legs need stainless.",
      ),
      concept(
        "concept-b",
        "B · Acrylic tower",
        "b-acrylic-tower.png",
        "≈ 132 × 116 × 290 mm",
        "Resin, cast acrylic, aluminium",
        "Rocket in a clear block on the base",
        "Protects the legs; +$40 a piece, 1.9 kg.",
      ),
      concept(
        "concept-c",
        "C · Launch tower",
        "c-launch-tower.png",
        "≈ 150 × 116 × 335 mm",
        "Resin, steel, aluminium",
        "Rocket, service tower, base",
        "Bold silhouette; the tower hides the side plaque.",
      ),
    ];
  },
);
await step(
  {
    phase: "concepts",
    kind: "manual",
    title: "Starred A and B, set C aside",
    caption:
      "Manual: the designer stars the two worth keeping and discards the tower.",
  },
  () => {
    state.concepts[0].starred = true;
    state.concepts[1].starred = true;
    state.concepts[2].discarded = true;
  },
);
await step(
  {
    phase: "concepts",
    kind: "manual",
    title: "Concept A chosen",
    caption:
      "The decision carries the qualities to keep and the open questions into the Model phase.",
  },
  () => {
    state.decision = {
      ...stamp("2026-05-08T14:00:00.000Z"),
      conceptId: "concept-a",
      qualities: [
        {
          label: "Silhouette",
          value: "Slim booster on splayed legs",
          approved: true,
        },
        {
          label: "Base",
          value: "Black hex with three silver plaques",
          approved: true,
        },
        { label: "Colours", value: "Gloss white, black bands", approved: true },
      ],
      targets: "Within 140 × 130 × 400 mm; stable against a 10° tip",
      questions: [
        {
          id: "q-legs",
          text: "Stainless legs strong enough at Ø1.6 mm?",
          owner: "maker",
        },
        {
          id: "q-base",
          text: "Is a 28 mm base tall enough for the plaques?",
          owner: "model",
        },
      ],
      briefVersion: 1,
    };
  },
);

// Model ------------------------------------------------------------------------------------------
await step({
  phase: "model",
  kind: "agent",
  model: OPUS,
  revision: 1,
  title: "Mantel starts the model in MantelCAD",
  caption:
    "From concept A: the hex base, the landing pad and the rocket's stages and ogive fairing, as a MantelCAD design with named parameters.",
  prompt: "Start the model from concept A.",
  response:
    "Revision r1 is saved and built in MantelCAD: a 132 mm hex base 28 mm tall, a 96 mm landing pad with its ring and cross, and the rocket in five sections (engine bay, first stage, interstage, second stage, ogive fairing) on a 16 mm body. base_height, pad_diameter and body_diameter are parameters you can change.",
  actions: [
    {
      name: "model_edit",
      ok: true,
      detail: "Model revision 1 saved; its build is queued",
    },
  ],
  focus: ".phase-agent",
});
await step({
  phase: "model",
  kind: "agent",
  model: OPUS,
  revision: 2,
  title: "Engines, landing legs and grid fins",
  caption:
    "The agent adds the hardware with MantelCAD commands; each change is a new revision, built automatically.",
  prompt: "Add the nine engines, the four landing legs and the grid fins.",
  response:
    "r2 adds nine engine bells (one centre, eight around), four A-frame landing legs in 1.6 mm struts with feet on the pad, and four grid fins at the interstage. The legs spread to 76 mm across, inside the pad.",
  actions: [
    {
      name: "model_edit",
      ok: true,
      detail: "Model revision 2 saved; its build is queued",
    },
  ],
  focus: ".phase-agent",
});
await step({
  phase: "model",
  kind: "manual",
  revision: 3,
  title: "The designer raises the base to 32 mm",
  caption:
    "Manual change in the parameter panel: base_height 28 → 32 mm, so the plaque text clears the edges. Everything above moves up with it.",
});
await step({
  phase: "model",
  kind: "agent",
  model: OPUS,
  revision: 4,
  title: "Lettering and plaques from the approved artwork",
  caption:
    "SPACEX, NASDAQ: SPCX and IPO 2026 up the rocket; three silver plaques with raised lettering on the base.",
  prompt:
    "Add the lettering and the three plaques, using the approved artwork.",
  response:
    "r4 has the lettering raised 0.3 mm up the rocket's front: SPACEX on the first stage, NASDAQ: SPCX on the second, IPO 2026 on the fairing. The three plaques are 58 mm wide on the front faces of the base, with the offering, the listing and the occasion in raised black lettering. Colours follow the brief.",
  actions: [
    {
      name: "model_edit",
      ok: true,
      detail: "Model revision 4 saved; its build is queued",
    },
  ],
  focus: ".phase-agent",
});
await step({
  phase: "model",
  kind: "system",
  revision: 4,
  title: "Checks on every build",
  caption:
    "Mantel measures each build: inside the envelope, but the tip check is marginal with a 96 mm pad under a 371 mm rocket.",
});
await step(
  {
    phase: "model",
    kind: "manual",
    revision: 5,
    title: "Pad widened to 104 mm; r5 marked ready",
    caption:
      "Manual change: pad_diameter 96 → 104 mm. The tip check passes, and the designer marks r5 ready for documents.",
  },
  () => {
    state.decision.questions = state.decision.questions.map((q) => ({
      ...q,
      resolved: stamp("2026-05-12T16:00:00.000Z"),
    }));
    state.modelReady = {
      ...stamp("2026-05-12T16:05:00.000Z"),
      revision: 5,
      briefVersion: 1,
    };
  },
);

// Documents --------------------------------------------------------------------------------------
await step(
  {
    phase: "documents",
    kind: "agent",
    model: OPUS,
    revision: 5,
    title: "Proof, parts list and assembly, drafted from r5",
    caption:
      "Mantel drafts the manufacturing documents from the model and the brief; the drawings come from the build.",
    prompt:
      "Draft the customer proof, parts list, assembly instructions and inspection checklist for r5.",
    response:
      "Drafted from r5 and brief v1: the customer proof with the render and every line of lettering, a parts list of 12 lines, assembly in 8 steps (legs bonded into the engine bay, plaques bonded flush), and an inspection checklist that covers the leg alignment, the lettering and the plaque copy. The part drawings come from the build as PDF and DXF.",
    actions: [{ name: "phases_save", ok: true, detail: "Phase changes saved" }],
    focus: ".phase-agent",
  },
  () => {
    const docs = {
      proof:
        "Customer proof · SpaceX IPO deal toy · r5\n\nOverall 132 × 116 × 375 mm. Gloss white rocket on four stainless landing legs, on a 104 mm landing pad and a black hexagonal base 32 mm tall.\n\nRocket lettering (black, raised): SPACEX · NASDAQ: SPCX · IPO 2026.\nFront plaque: SPACEX / INITIAL PUBLIC OFFERING / $75,000,000,000.\nRight plaque: NASDAQ / SPCX / JUNE 12, 2026.\nLeft plaque: IPO / JUNE 2026.\n\nPlease check every line of copy before you approve.",
      parts:
        "1  Rocket body, cast resin, gloss white · 1\n2  Fairing, cast resin, gloss white · 1\n3  Interstage band, black · 1\n4  Engine bay with 9 bells, black / gunmetal · 1\n5  Grid fins, black · 4\n6  Landing leg strut, Ø1.6 stainless · 4\n7  Landing leg brace, Ø1.6 stainless · 4\n8  Leg foot, stainless · 4\n9  Landing pad, aluminium, gunmetal · 1\n10 Pad ring and cross, silver · 1\n11 Hex base, aluminium, black powder coat · 1\n12 Plaques, anodised aluminium, brushed silver · 3",
      assembly:
        "1. Bond the fairing to the second stage.\n2. Fit the grid fins into the interstage slots.\n3. Bond the struts and braces into the engine bay at the four leg points.\n4. Bond the feet to the pad at the four marks.\n5. Seat the rocket so each foot sits on its mark.\n6. Fix the pad to the base with two M3 screws from below.\n7. Bond the plaques flush to the three front faces.\n8. Clean, inspect and pack in the foam insert.",
      inspection:
        "☐ All four feet touch the pad (no rock)\n☐ Rocket vertical within 1°\n☐ Lettering complete and level\n☐ Plaque copy matches the proof exactly\n☐ No paint runs on white surfaces\n☐ Box and card included",
      revisions:
        "r1 start · r2 hardware · r3 base 32 mm · r4 lettering and plaques · r5 pad 104 mm",
      files: "STEP, STL and 3MF from r5; drawings as PDF and DXF.",
      drawings: "Part drawings generated from r5's STEP.",
    };
    for (const [kind, content] of Object.entries(docs))
      state.docs[kind].content = content;
  },
);
await step({
  phase: "documents",
  kind: "system",
  revision: 5,
  title: "Drawings from the build",
  caption:
    "The blueprint PDF and DXF were generated from r5's exact geometry, with no one redrawing anything.",
});
await step(
  {
    phase: "documents",
    kind: "manual",
    revision: 5,
    title: "Documents approved and released",
    caption:
      "Each document is approved against r5 and brief v1, and the release goes to manufacturing.",
  },
  () => {
    for (const kind of Object.keys(state.docs))
      state.docs[kind].approved = {
        ...stamp("2026-05-14T11:00:00.000Z"),
        revision: 5,
        briefVersion: 1,
      };
    state.release = {
      ...stamp("2026-05-14T11:05:00.000Z"),
      revision: 5,
      briefVersion: 1,
    };
  },
);

// Manufacture (Jiga, simulated) ------------------------------------------------------------------
const message = (id, from, text, when, author) => ({
  id,
  from,
  text,
  at: when,
  ...(author ? { author } : {}),
});
const suppliers = {
  kestrel: {
    id: "kestrel",
    name: "Kestrel Precision",
    scope: "Whole toy",
    via: "jiga",
    messages: [],
  },
  harbor: {
    id: "harbor",
    name: "Harbor & Pike Metalcraft",
    scope: "Whole toy",
    via: "jiga",
    messages: [],
  },
  larkspur: {
    id: "larkspur",
    name: "Larkspur Resin Works",
    scope: "Rocket and legs",
    via: "jiga",
    messages: [],
  },
  client: {
    id: "client",
    name: "SpaceX IPO deal team",
    scope: "Client",
    kind: "client",
    messages: [],
  },
};
await step(
  {
    phase: "manufacture",
    kind: "system",
    revision: 5,
    title: "The release goes out to Jiga",
    caption:
      "Simulated Jiga integration: the RFQ for release r5 (250 pieces, in hand July 15) goes to three manufacturers in Jiga's network with the STEP and drawings attached.",
    focus: ".jiga-strip",
  },
  () => {
    state.suppliers = [
      suppliers.kestrel,
      suppliers.harbor,
      suppliers.larkspur,
      suppliers.client,
    ].map(clone);
    for (const s of state.suppliers.filter((x) => x.via))
      s.messages.push(
        message(
          `${s.id}-rfq`,
          "us",
          "RFQ: 250 pieces of release r5. STEP, drawings and proof attached. In hand July 15, New York.",
          "2026-05-14T12:00:00.000Z",
        ),
      );
  },
);
const set = (id, fn) => {
  const s = state.suppliers.find((x) => x.id === id);
  fn(s);
};
await step(
  {
    phase: "manufacture",
    kind: "message",
    revision: 5,
    title: "Three quotes back through Jiga",
    caption:
      "Quotes arrive in each supplier's thread: price per piece, sample time and run time.",
    focus: ".mfg-grid .doc-list",
  },
  () => {
    set("kestrel", (s) => {
      s.quote = {
        price: "$148 / piece · $37,000",
        lead: "Sample 9 days · run 21 days",
      };
      s.messages.push(
        message(
          "kestrel-q",
          "them",
          "Quoted through Jiga: $148 a piece for 250. Resin rocket, aluminium base and plaques, stainless legs. Sample in 9 days, run 21 days.",
          "2026-05-15T03:20:00.000Z",
        ),
      );
    });
    set("harbor", (s) => {
      s.quote = {
        price: "$171 / piece · $42,750",
        lead: "Sample 7 days · run 18 days",
      };
      s.messages.push(
        message(
          "harbor-q",
          "them",
          "$171 a piece. Base and plaques machined in-house; resin outsourced. Sample 7 days, run 18 days.",
          "2026-05-15T14:05:00.000Z",
        ),
      );
    });
    set("larkspur", (s) => {
      s.quote = {
        price: "$96 / piece (rocket and legs only)",
        lead: "Sample 6 days · run 15 days",
      };
      s.messages.push(
        message(
          "larkspur-q",
          "them",
          "We can do the rocket and legs only, $96 a piece. Base would need another shop.",
          "2026-05-15T16:40:00.000Z",
        ),
      );
    });
  },
);
await step({
  phase: "manufacture",
  kind: "agent",
  model: OPUS,
  revision: 5,
  title: "Mantel compares the quotes against the brief",
  caption:
    "The agent reads every quote against the budget, the deadline and the release.",
  prompt: "Compare the quotes against the brief and recommend one.",
  response:
    "Kestrel Precision fits best: $148 a piece ($37,000) is under the $180 budget, and a 9-day sample plus a 21-day run lands about July 9, ahead of the July 15 deadline. Harbor & Pike is faster but $171 a piece. Larkspur quotes only the rocket and legs, so a second shop would have to make the base and plaques, which splits the release. Before you order, ask Kestrel to confirm the plaques are anodised, not painted.",
  actions: [
    { name: "phases_get", ok: true, detail: "Project information read" },
  ],
  focus: ".phase-agent",
});
await step(
  {
    phase: "manufacture",
    kind: "message",
    revision: 5,
    select: "kestrel",
    title: "A question to Kestrel, answered through Jiga",
    caption:
      "The thread with the supplier stays with the project and the release it is about.",
    focus: '[data-supplier="kestrel"]',
  },
  () => {
    set("kestrel", (s) => {
      s.messages.push(
        message(
          "kestrel-ask",
          "us",
          "Can you confirm the plaques are brushed and anodised, with the lettering raised rather than printed?",
          "2026-05-16T09:00:00.000Z",
        ),
        message(
          "kestrel-yes",
          "them",
          "Confirmed: brushed 6061, clear anodised, lettering raised 0.4 mm and filled black. Photos with the sample.",
          "2026-05-16T11:30:00.000Z",
        ),
      );
    });
  },
);
await step(
  {
    phase: "manufacture",
    kind: "message",
    revision: 5,
    select: "client",
    title: "The client approves the proof",
    caption:
      "The deal team reviews the proof in its own thread and signs off the copy.",
    focus: '[data-supplier="client"]',
  },
  () => {
    set("client", (s) => {
      s.messages.push(
        message(
          "client-proof",
          "us",
          "Here is the proof for r5 with every line of copy. Please check the offering size and the dates.",
          "2026-05-16T13:00:00.000Z",
        ),
        message(
          "client-ok",
          "them",
          "Copy is right: $75,000,000,000 and June 12. Approved. Can we have them by July 10 for the closing dinner?",
          "2026-05-16T17:45:00.000Z",
          "Maya R., deal team",
        ),
        message(
          "client-date",
          "us",
          "Kestrel's schedule lands July 9, so yes.",
          "2026-05-16T18:10:00.000Z",
        ),
      );
    });
  },
);
await step(
  {
    phase: "manufacture",
    kind: "manual",
    revision: 5,
    select: "kestrel",
    title: "Order placed with Kestrel Precision",
    caption:
      "The designer chooses Kestrel's quote; the order is tied to release r5.",
    focus: ".thread-head",
  },
  () => {
    state.order = {
      ...stamp("2026-05-17T09:00:00.000Z"),
      supplierId: "kestrel",
      stage: "Ordered",
    };
  },
);
await step(
  {
    phase: "manufacture",
    kind: "message",
    revision: 5,
    select: "client",
    title: "Sample photos, and the client signs off",
    caption:
      "Kestrel's sample photos come through Jiga; the deal team approves the sample.",
    focus: '[data-supplier="client"]',
  },
  () => {
    set("kestrel", (s) => {
      s.messages.push(
        message(
          "kestrel-sample",
          "them",
          "Sample shipped, photos attached: legs square, all four feet seated, plaques flush.",
          "2026-05-27T08:00:00.000Z",
        ),
      );
    });
    set("client", (s) => {
      s.messages.push(
        message(
          "client-sample",
          "us",
          "Sample photos from the factory: front, plaques and the legs close up.",
          "2026-05-27T10:00:00.000Z",
        ),
        message(
          "client-sample-ok",
          "them",
          "Looks fantastic. Approved for production.",
          "2026-05-27T15:20:00.000Z",
          "Maya R., deal team",
        ),
      );
    });
    state.order = {
      ...state.order,
      ...stamp("2026-05-27T15:30:00.000Z"),
      stage: "Sample approved",
    };
  },
);
await step(
  {
    phase: "manufacture",
    kind: "system",
    revision: 5,
    select: "kestrel",
    title: "In production; arriving July 9",
    caption:
      "Jiga tracks the run: 250 pieces in production, shipping to New York ahead of the July 15 deadline.",
    focus: ".thread-head",
    ms: 9000,
  },
  () => {
    set("kestrel", (s) => {
      s.messages.push(
        message(
          "kestrel-run",
          "them",
          "Production started on 250 pieces. Ship date July 6, delivery July 9.",
          "2026-06-12T07:00:00.000Z",
        ),
      );
    });
    state.order = {
      ...state.order,
      ...stamp("2026-06-12T07:05:00.000Z"),
      stage: "In production",
    };
  },
);

const script = {
  version: 1,
  title: "SpaceX IPO deal toy",
  summary:
    "From the client's render to an order in production: the brief, artwork, concepts, five MantelCAD revisions, documents, and quotes and approvals through Jiga. A recorded walkthrough.",
  steps,
};
console.log(await call("demo_save", { projectId, script }));
await api(`/api/settings/projects/${projectId}/demo`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ demo: true }),
});
console.log("demo ready:", steps.length, "steps");
