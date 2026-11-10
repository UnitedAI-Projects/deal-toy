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

## Now: phased project workspace (UI first)

The five phases from the [phased workspace design](superpowers/specs/2026-11-10-phased-project-workspace-design.md) are usable in the interface ([plan](superpowers/plans/2026-11-10-phased-workspace-ui.md)). Each of these stand-ins needs its own design next:

1. **Phase data on the server.** Done: `phase_states` and `phase_files` (migration 0012), `phases_get`, `phases_save` and `phase_files_list` for the UI and MCP, approval stamping and the agent guard, live updates, and a one-time import from browser storage.
2. **The built-in agent.** The panel shows deterministic guidance (`agentGuide`) and sends notes. A real in-app agent needs a provider and cost decision first.
3. **Concept generation, client share links and the manufacturing service.** Their controls are disabled or labelled "saved here, not sent".

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

There is no built-in chat model, provider-key storage, automatic tool-code installation, supplier ordering, production approval, reviewed or feature-dimensioned engineering drawings or CAD GUI feature tree in this foundation. A script and its exported result are the current editable model contract. These are explicit extension points, not hidden completed features.
