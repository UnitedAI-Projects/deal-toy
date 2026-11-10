# Phased project workspace: Brief, Concepts, Model, Documents, Manufacture

Status: proposed UX design, 2026-11-10. This is the interface only. The data model, agent runtime, CAD backend and manufacturing integration each need their own design before anything is built. Mockup: [2026-11-10-phased-workspace-mockup.html](../../design/2026-11-10-phased-workspace-mockup.html). Screenshots: `docs/design/2026-11-10-phased-*.png`.

## Intent

Today a Mantel project is one modeling workspace: an external agent connects over MCP, records a design sheet, and builds the model, and manufacturing documents are a side panel. The product owner wants a project to work like the real deal-toy job does. Agree the brief, explore rough ideas quickly, model the chosen one properly, produce the manufacturing package, then make it. Each step has its own kind of work and ends in something a person approves.

The second shift is that the **first way in is an agent inside Mantel**, not an MCP client. The agent guides the person through every phase and helps with the work in each one. MCP stays as a second way in that uses the same tools.

The look stays as it is: warm neutral canvas, floating glass cards and pills, Inter, monospace for values, and indigo for agent activity only. What changes is how a project is organised and driven.

## Decisions already made

From the product owner, 2026-11-10:

- **Five phases per project:** design brief, concept exploration, CAD modeling, document creation and manufacturing. (The request said "three phases" and then listed five. This design uses all five.)
- **The brief is a structured specification** covering logos and artwork, size, budget, deadline, material, finish, constraints, adjustability, packaging, fragile details, assembly, appearance and similar items. The person reviews it. It is the shared source for the modeling and document phases.
- **Human in the loop.** The person reviews what each phase produces.
- **Concepts are disposable.** Rough meshes and sketches, several concepts at once, generated quickly, nothing permanent. They settle proportions, depth, shape, material and components before detailed modeling. The output is the chosen concept, its approved visual qualities, and the questions still open.
- **Modeling is built on a production CAD system**, with named parts, dimensions, relationships and construction operations. For example, tower height is an editable dimension, cable thickness is controlled on its own, mounting holes belong to a specific part, and logos stay exact artwork with a defined placement. Both the person and the agent can edit the model.
- **Documents** include the customer proof, part drawings, parts list, assembly instructions, manufacturing files, inspection checklist and revision summary.
- **Manufacturing** goes through a middleman service that contacts manufacturers and lets the team discuss parts with them inside the app. Its details are not decided yet.
- **An in-app agent first**, guiding and assisting in every phase. MCP access is no longer the primary path.
- **Keep the overall look of the app.**

## Goals

1. **One project, five phases, always visible.** The person can always see which phase the project is in, what each phase produced, and what is stale.
2. **Each phase ends in an approved output.** The approved brief, the chosen concept, a model revision marked ready for documents, a release package, and an order. A person approves each one.
3. **The brief is the contract.** Later phases check against it and point to it. When it changes, everything built on the old version says so.
4. **One agent, present everywhere.** The same panel in every phase, aware of the phase it is in, able to ask, propose, generate and edit, and never the one who approves.
5. **Fast where it should be, exact where it must be.** Concepts take seconds and carry no ceremony. The model is exact and named. The interface makes the difference visible, so nobody mistakes a concept mesh for a part.
6. **Going back is normal.** A client changes the logo after the proof: the brief reopens, the model and documents are marked stale, and the person is shown exactly what to redo.

## Non-goals

- The data model, persistence and APIs behind the phases. That is a separate architecture design.
- Choosing the CAD backend. Today it is build123d on Open CASCADE. Whether that counts as the "production CAD system" or something like Onshape or Fusion replaces it is an architecture decision, and this UI does not depend on it.
- Choosing the agent's model or provider, and how usage is paid for.
- The manufacturing middleman's actual integration. The Manufacture phase is drawn against a generic quote, message and order flow and will change once a provider is chosen.
- Client accounts. Clients review the brief and the proof through a share link. Full client logins come later. _(my call)_
- Redesigning Settings, sign-in or Trash.

## Anti-goals

- **Locked phases.** A wizard that will not let the person look ahead, or that makes a small fix in the model mean redoing the brief. Phases are a map, not a cage.
- **Approval by the agent.** The agent recording "approved" on anyone's behalf, or wording that makes an agent proposal look like a confirmed decision.
- **A concept that passes for a part.** A concept mesh flowing into documents or to a manufacturer, or concept proportions copied into the model without anyone choosing to.
- **Silent staleness.** A proof, drawing or quote that still looks current after the model or brief it came from has changed.
- **A chat that hides the work.** The brief, the concept board, the model and the documents are the work surfaces. Chat is how you drive them, not where the results live.
- **Losing the current workspace.** The Model phase must keep what already works: tool bar, Browser, timeline, inspect, checks, revisions and agent presence.

## Words used here

- **Phase:** one of Brief, Concepts, Model, Documents and Manufacture. _(Calling the first phase "Brief" rather than "Design" is my call. "Design" is too broad and would collide with the design sheet.)_
- **Output:** what a phase hands on. These are the brief version, the concept decision, the model revision marked ready, the release package and the order.
- **Approve:** a person's recorded sign-off on an output, with their name and the time.
- **Stale:** an output built on an older version of something upstream.

## The frame

Every phase uses the same frame.

- **Top left:** the ◇ Mantel chip and the project chip, as today.
- **Top centre: the phase bar.** A pill with five segments: Brief, Concepts, Model, Documents, Manufacture. Each segment shows its number and a status dot. Grey means not started, indigo means in progress, green ✓ means approved, and amber means stale. Clicking a segment opens that phase whatever its status. A phase whose inputs are not approved yet opens with a banner that says so and offers to go back. It is not blocked.
- **Top right:** search, the agent status chip and ⋯, as today. Phase-specific buttons sit before them, such as Checks in Model and Share in Brief and Documents.
- **Left: the agent panel.** The existing chat panel becomes a real conversation. The input reads "Ask Mantel…" instead of "Leave a note for the agent…". It collapses to a single floating chip. See [the agent](#the-agent).
- **Centre and right: the phase's work surface.**
- **Bottom: the phase's output bar.** A floating card that says what this phase is producing, what is missing, and the approve button. For example: "Brief v2 · 16 of 18 required answered · 2 assumed · Approve brief". This bar is the one consistent place to finish a phase.

In the Model phase, the CAD tool bar sits directly under the phase bar as a second floating row, so the phase bar never moves between phases.

On phones, the phase bar becomes a single chip ("2 Concepts ▾") that opens the list of phases. The agent panel becomes a bottom sheet with a peek row, and the output bar sits above the sheet's peek row.

## Phase 1: Brief

**Surface:** a document-like specification in the centre column (about 720 px wide), with a narrow section index on its right. It reads like a printed spec and edits in place.

**Sections:** _(grouping is my call; the fields are the owner's list plus the deal facts any toy needs)_

| Section              | Fields                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Occasion             | Deal name, parties, deal date, recipients, quantity, what the toy should say about the deal                                       |
| Commercials          | Budget per unit and in total, deadline (in hand by), delivery address, rush allowed                                               |
| Artwork              | Logos (vector files), wording and lettering, colour references (Pantone), placement wishes, approval owner for each mark          |
| Size                 | Maximum envelope W × D × H, target weight, desk footprint                                                                         |
| Materials and finish | Primary material, secondary materials, finish for each, embedded objects                                                          |
| Form and features    | Subject or metaphor (bridge, tower, tombstone), adjustability and moving parts, assembly appearance (seamless, visible fasteners) |
| Constraints          | Fragile details, minimum feature sizes, things to avoid, regulatory or brand rules                                                |
| Packaging            | Box type, insert, presentation, shipping protection                                                                               |
| Notes                | Anything else the client said                                                                                                     |

**Each field** has a value and a source: _you_, _agent, from the conversation_, or _from a file_ with the file named. It also has a state: answered, assumed (an agent guess, shown with the existing amber "assumed" chip), open (still needed), or not applicable. Required fields are marked. A field that has a value but is not confirmed shows the agent's proposal with ✓ Confirm and Edit beside it.

**Files:** dropping an email, an RFP PDF or logo files on the brief, or in the agent panel, attaches them. The agent fills the fields it can and marks each one "from file". Logos land in Artwork as exact files. Raster logos get a warning that they need vector artwork before modeling.

**The agent's job here:** to interview the person. It asks one question at a time, starting with the most important open field. It proposes values and marks guesses as assumed, never as answered. It does not move on to Concepts by itself.

**Output bar:** "Brief v1 draft · 12 of 18 required · 3 assumed · 3 open · Approve brief". Approve stays disabled while required fields are open, and the bar names them. Assumed fields can be approved, but the approval dialog lists them so the person approves them knowingly. **Share for client review** produces a read-only link to the specification (see Non-goals).

**After approval:** the brief becomes v1 approved. Editing it creates v2 draft and leaves v1 as the approved version until v2 is approved. When v2 is approved, each later phase built on v1 turns amber with a "Brief changed: 2 fields" banner listing the changes.

## Phase 2: Concepts

**Surface:** a board of concept cards on the canvas, with the agent panel on the left.

**A concept card** shows a quick 3D preview (a rough mesh you can turn by dragging), or a sketch, or both. Under it are a short name ("B · Single tower, cable fan"), rough proportions (≈ 180 × 80 × 210 mm), material swatches and a list of the main components. A card is visibly rough: a dashed border, a "Concept" tag, and no dimension styling in monospace. This keeps concepts from passing for parts.

**Making concepts:** the board's floating tool row has Generate (from the brief, or from a prompt), Sketch (draw on a blank card or over a preview), Upload reference (photos or a mood image), Vary (from the selected card: "taller", "two towers", "walnut base"), and Compare. Generation fills placeholder cards that resolve in place, so the person sees how many are coming.

**Working a concept:** opening a card gives a larger preview with sliders for the few proportions that matter (overall height, base depth, tower-to-span ratio), a material and finish picker, and the component list. Changes regenerate quickly. Nothing is saved as a revision. The card keeps a short undo history.

**Checks against the brief:** each card shows light warnings drawn from the approved brief. "Taller than the 200 mm envelope" and "Glass embed is outside the budget" are examples. They are warnings, not blockers.

**Nothing permanent:** cards can be starred or discarded. Discarded cards move to a tray at the edge of the board. They are not deleted, so a client who says "actually, the first one" can be answered. _(Keeping a tray rather than deleting is my call.)_

**Choosing:** **Choose this concept** opens the decision sheet:

- **Approved visual qualities:** checkboxes for silhouette, proportions, material and finish, and components, each with the value carried forward ("Single tower, 210 mm tall, height to span 1.2 : 1").
- **Proportions to carry into the model:** rough numbers, labelled as targets, not dimensions.
- **Open questions:** filled in by the agent and editable. Each one is tagged for whoever must answer it: the client, the maker, or the model. "Can the cables be 0.8 mm stainless wire?" and "Does the client want the deal date on the front or the base?" are examples.
- **Brief updates:** if the chosen concept contradicts the brief (it is taller than the envelope), the sheet asks whether to update the brief, which creates a new version, or to keep the brief and adjust in the model.

**Output bar:** "Choose a concept to continue · 6 concepts · 2 starred".

## Phase 3: Model

**Surface:** the current workspace: canvas, the floating CAD tool bar, the Browser card, inspect, checks, the timeline and revisions. It changes in four ways.

1. **Named parts and their dimensions are first class.** The Browser card gains a **Parts** section listing every named part (Tower, Deck, Cables, Base, Logo plate). Selecting a part shows its own dimensions ("Tower height 210 mm"), what controls it ("Cable thickness: independent"), what depends on it ("Deck clearance follows tower height"), and its features ("4 × M3 mounting holes, belong to Base"). The existing part card with editable values and "Ask the agent to change this part…" becomes this panel.
2. **Artwork is placed, not modeled.** Logos and lettering from the brief appear in an **Artwork** section. Each one has its source file, a placement frame on a chosen face (position, size and rotation in mm), and its method (engrave, print, inlay, raised). The artwork itself cannot be edited in Mantel, which keeps it exact.
3. **The concept is a reference.** A **Concept** toggle in the view shows the chosen concept as a faint ghost overlay at its rough proportions, so the model can be compared with what was approved. The concept's open questions appear as a small checklist card. Each question is answered or resolved from there and records who resolved it.
4. **Brief checks join the existing checks.** Envelope, budget estimate (once costing exists), minimum feature size and quantity-driven warnings come from the approved brief and sit alongside stability, embed wall and the other checks. A failing brief check offers to open the brief.

**The agent's job here** is the existing structured workflow: design sheet, change plans, layers and presence on the canvas. The prompt now comes from the in-app panel. The design sheet is generated from the approved brief and the concept decision rather than asked again. _(My call: the design sheet becomes the modeling view of the brief, not a second interview.)_

**Output bar:** "Revision r7 · 12 of 12 checks pass · 2 open questions · Mark ready for documents". Marking ready is a person's action, and it names the revision. A later revision makes "ready" stale until it is marked again.

## Phase 4: Documents

**Surface:** a document list on the left of the work area and a large preview on the right. The agent panel stays at the far left and collapses easily here.

**The list:** Customer proof, Part drawings (one per part), Parts list, Assembly instructions, Manufacturing files (STEP, STL, DXF and the artwork files), Inspection checklist and Revision summary. Each row shows the revision and brief version it was built from, and its state: not generated, draft, needs review, approved, or stale (amber, with "Model changed: r7 → r8").

**The preview** shows the actual document. Drawings use the existing blueprint adapter, and the proof is a client-facing sheet with renders, overall size, materials, finish and artwork placement. A side strip lists what the document draws on, such as "Tower height from r7" and "Logo from brief v2, Artwork". Values that no source supports are flagged, never invented.

**Customer proof:** Share for client approval sends a link (see Non-goals). The client can approve or ask for changes. A request for changes appears in the agent panel and offers to reopen the brief or the model.

**The agent's job here:** to generate and update documents, write the assembly steps and the revision summary, and point out gaps, such as "The inspection checklist has no tolerance for the cable spacing". It cannot approve any document.

**Output bar:** "Release package · 7 of 9 approved · all on r7 · Create release". Create release stays disabled until every required document is approved and all of them point to the same revision. This keeps the release-manifest rule from `docs/manufacturing.md`.

## Phase 5: Manufacture

**Surface:** a list of suppliers and requests on the left and the selected thread on the right. _(Drawn against a generic flow; it will change once the middleman is chosen.)_

- **Request for quote:** built from the release. The person picks the parts to send, the quantity (from the brief) and the deadline, and Mantel shows exactly which files go out.
- **Quotes:** one card per manufacturer, with price, lead time and notes, side by side.
- **Threads:** messages with each manufacturer about specific parts. A message can point to a part, which opens it in a small read-only viewer. The agent drafts replies and summarises long threads. **A person sends every outgoing message**, because it leaves the company.
- **Order:** choosing a quote records the order and shows its progress (ordered, sample, sample approved, in production, shipped). Sample approval is a person's action and links back to the inspection checklist.
- A change a manufacturer requests ("we need a 2 mm wall here") offers to open the Model phase with that note attached to the part.

**Output bar:** "Order 1 · sample in review · in hand by 12 Dec".

## The agent

- **One panel, every phase.** The conversation is continuous for the project. A thin divider marks each phase change ("Now in Concepts"), so the history reads as one job.
- **Phase-aware greeting.** On opening a phase, the agent says what is missing and offers the next step. In Brief: "3 required fields left. Shall we do the budget?" In Documents: "The proof is ready for review."
- **Proposals look like proposals.** Anything the agent fills in is shown with its source and, until confirmed, as a proposal with ✓ Confirm. Agent activity stays indigo, as today.
- **Approvals are buttons, not chat.** The agent can say "ready for your approval" and highlight the output bar. Approving happens only by a person clicking.
- **External agents.** MCP agents that connect still appear in the same panel as labelled sessions, as they do today, and use the same tools and the same rules.
- **Collapsing.** The panel collapses to a chip showing the agent's status. While collapsed, agent work still shows on the work surface (presence on the canvas, cards resolving on the board).

## The project library

Project cards gain a five-dot phase strip and the current phase name ("Concepts · 6 concepts"), plus the deadline from the brief once it is set. A new project opens in Brief with the agent asking what the deal is.

## Calls I made (to check)

1. Five phases, using the five the request listed.
2. Phase names: Brief, Concepts, Model, Documents, Manufacture.
3. Phases are never locked. A phase whose inputs are not approved yet shows a banner, not a wall.
4. The phase bar is top centre in every phase, and in Model the CAD tool bar moves to a second row under it.
5. The brief's section grouping, and adding deal facts (parties, date, recipients, quantity) to the owner's list.
6. Approving a brief with assumed fields is allowed, with the assumptions listed in the approval dialog.
7. Discarded concepts go to a tray instead of being deleted.
8. The design sheet in the Model phase is derived from the brief and the concept decision.
9. Clients review the brief and proof through share links. Client accounts come later.
10. A person sends every outgoing message to a manufacturer. The agent drafts only.

## Open questions for the owner

These change what gets built later but not this UI:

- **Who is in the room?** Is the person using Mantel always the service company's designer, or will bankers and clients work in it directly? This decides how much of the client review flow moves inside the app.
- **Who chooses the concept?** Deal-toy firms often show the client two or three concepts and let the client pick. If so, Concepts needs a "present to client" step before Choose, and the proof is not the client's first look.
- **Built-in agent cost and provider.** The README lists "no built-in chat model, provider-key storage" as intentionally absent. An in-app agent reverses that, so somebody pays per conversation. That needs a decision before the agent is built.
- **"Production CAD system."** Does this mean keeping build123d/OCCT with a stronger parts and relationships layer, or moving to a commercial kernel or service?
- **Concept generation.** Which mesh or image generator produces concepts fast enough to count as quick, and what does each generation cost?

## Left to the builder

- Exact sizes, spacing and motion, within the current tokens in `src/web/style.css`.
- How the concept preview renders (GLB in the existing viewer or a lighter viewer).
- Keyboard shortcuts for switching phases.
- Empty states for each phase.

## What to validate when built

- Each phase at 1440 × 900 and 390 × 844, in light and dark themes.
- A full pass from a new project to an order using the synthetic bridge, with screenshots for each phase.
- Going back: change a logo in an approved brief and check that the model, documents and quotes turn stale with the right banners.
- That no agent action can produce an "approved" state.
