# Foundation and next increments

## First vertical slice

- Project browser and per-project modeling workspace.
- Immutable source revisions and concurrent-edit conflict rejection.
- Build123d/OCCT builds with STEP, STL, GLB and geometry facts.
- Stateless HTTP MCP using the same permission-checked tool registry as the web UI.
- Versioned skills, tool enable/disable controls, draft manufacturing documents.
- GitHub-hosted tests and isolated Cloudflare release workflow; no agent runner.
- Live agent sessions: verbatim prompts, progress notes, recorded tool calls, team notes delivered on the next tool call, WebSocket updates, click-to-edit part parameters and light/dark themes.
- Accounts: Google sign-in and signup, owner-edited access levels with per-person adjustments, a read-only demo project, OAuth sign-in for MCP clients, and the Mantel sign-in screen.

## Now: phased workspace and browser engines

The six phases are Brief, Art, Concepts, Model, Documents and Manufacture. The [phase engines design](superpowers/specs/2026-11-10-phase-engines-design.md) extends the original [workspace design](superpowers/specs/2026-11-10-phased-project-workspace-design.md). Browser editors open inside the workspace and save editable files back to the project. This interface integration does not yet replace the server's build123d model contract.

1. **Phase data on the server.** Done: `phase_states` and `phase_files` (migration 0012), `phases_get`, `phases_save` and `phase_files_list` for the UI and MCP, approval stamping and the agent guard, live updates, and a one-time import from browser storage.
2. **The built-in agent.** The panel shows deterministic guidance (`agentGuide`) and sends notes. Cloudflare Workers AI is the selected provider; bounded inference and project-scoped actions are the next implementation step.
3. **Browser engines.** MantelPDF handles reference and proof PDFs, MantelArt handles artwork, MantelMesh handles rough polygon concepts, MantelCAD handles detailed interactive designs, and MantelDocs handles drawings. Their code lives in this repository under engines/. See [engine integration](../engines/README.md) for build and hosting details.
4. **Native model builds and agent tools.** MantelCAD designs save as .sc phase files, but the main model canvas, revisions, build jobs and document provenance still use build123d. Introduce a versioned model-engine contract and run the same MantelCAD CLI in the isolated build container before treating a CAD save as a production model revision.
5. **Concept generation and mesh editing.** The browser mesh editor supports primitives, face selection, transforms, extrude/inset, materials, undo and file export. Modifiers, loop cut, bevel, sculpting and the hosted agent interface remain planned.
6. **Client share links and manufacturing.** Jiga integration is explicitly paused. Disabled controls and saved supplier drafts do not send messages or orders.

## Next: agent presence and change history

Design sheets, change plans and the guard are in place (Part 1 of the [sequential editing design](superpowers/specs/2026-11-09-sequential-editing-and-agent-presence-design.md)). Next, each as its own plan:

1. **Agent presence on the canvas:** a selector on the layer an agent is working on, a shape-shifting placeholder in its region, and a summary that updates from `change_progress`, including on an empty project.
2. **Layers panel and change timeline:** the framework's layers on the right, edited in place, and a line on the bottom with one point per request, built from `change_id`.
3. **Faster builds:** shorter feedback while an agent works through a plan.

Known limit: `appearance` colours whole parts. Colouring one area of a part, such as a gold rim on a white cup, needs that area modelled as its own part until face-level colour exists.

## Next: manufacturer-ready package

1. Add a structured part/BOM model and native assemblies, preserving material and placement metadata.
2. Add drawing specifications to the geometry-derived blueprint adapter: feature and hole-position dimensions on the views, tolerances and revision invalidation.
3. Add supplier/process profiles and measured DFM checks with cited limits and explicit unknowns.
4. Add human reviews, revision invalidation, immutable release manifests and ZIP export of source, geometry, drawings, BOM and brief.

## Next: team and client access

- Project sharing with explicit viewer/editor/approver roles. Sessions, events and notes are already keyed by project, so sharing changes access checks, not the activity model.
- Email-and-password accounts once a domain is set up for verification and reset email, with Turnstile on signup.
- An audit log view in Settings (changes are already recorded in `audit_events`).
- Usage accounting and budgets beyond the daily build cap, and build cancellation.
- Reference uploads with scoped read access, asset provenance and independent artifact checks.

## Intentionally absent

There is no built-in chat model, provider-key storage, automatic tool-code installation, supplier ordering, production approval, reviewed or feature-dimensioned engineering drawings in this foundation. MantelCAD has an interactive feature tree, but a build123d script and its exports remain the server model contract. These are explicit extension points, not hidden completed features.
