# Foundation and next increments

## First vertical slice

- Project browser and per-project modeling workspace.
- Immutable source revisions and concurrent-edit conflict rejection.
- Build123d/OCCT builds with STEP, STL, GLB and geometry facts.
- Stateless HTTP MCP using the same permission-checked tool registry as the web UI.
- Versioned skills, tool enable/disable controls, draft manufacturing documents.
- GitHub-hosted tests and isolated Cloudflare release workflow; no agent runner.
- Live agent sessions: verbatim prompts, progress notes, recorded tool calls, team notes delivered on the next tool call, WebSocket updates, click-to-edit part parameters and light/dark themes.

## Next: manufacturer-ready package

1. Add a structured part/BOM model and native assemblies, preserving material and placement metadata.
2. Add drawing specifications and a geometry-derived PDF adapter; test dimension correctness and render legibility.
3. Add supplier/process profiles and measured DFM checks with cited limits and explicit unknowns.
4. Add human reviews, revision invalidation, immutable release manifests and ZIP export of source, geometry, drawings, BOM and brief.

## Next: team and client access

- Project sharing with explicit viewer/editor/approver roles. Sessions, events and notes are already keyed by project, so sharing changes access checks, not the activity model.
- OAuth for clients that require browser consent rather than bearer configuration.
- Per-member quotas, cancellation and usage accounting.
- Reference uploads with scoped read access, asset provenance and independent artifact checks.

## Intentionally absent

There is no built-in chat model, provider-key storage, automatic tool-code installation, supplier ordering, production approval, automated engineering drawing generation or CAD GUI feature tree in this foundation. A script and its exported result are the current editable model contract. These are explicit extension points, not hidden completed features.
