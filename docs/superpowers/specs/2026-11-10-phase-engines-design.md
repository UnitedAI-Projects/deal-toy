# Phase engines: a real app behind every phase, running in the browser

Status: proposed, 2026-11-10. Builds on the [phased workspace](2026-11-10-phased-project-workspace-design.md), which is merged and running with browser-only phase data.

## Intent

The phased workspace is the front door: the phase bar, the agent panel, the output bars and approvals. Behind each phase, a full application does that phase's real work, and the person can open it from Mantel for detailed editing. The product owner's words: "The rest need to be the engine for each phase. They need to run in the browser."

| Phase       | Engine                                   | Repository                                                | What the engine owns                                                                                            |
| ----------- | ---------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Brief       | MantelPDF                                | `ichen27/mantelpdf`                                       | The specification PDF and the reference PDFs (RFP, brand guide), with markups                                   |
| Art _(new)_ | MantelArt                                | `ichen27/mantelart`                                       | Logo, lettering and illustration sources (`.vectorcraft`), with SVG and PDF exports                             |
| Concepts    | MantelMesh _(new browser mesh modeller)_ | to be decided ([design](2026-11-10-mantelmesh-design.md)) | One `.mmesh` per concept, with GLB and PNG exports for the board                                                |
| Model       | MantelCAD                                | `ichen27/mantelcad`                                       | The design file, its named parts, dimensions, relationships and timeline. STEP, STL and GLB are derived from it |
| Documents   | MantelPDF and MantelDocs                 | `ichen27/mantelpdf`, `ichen27/manteldocs`                 | Proof, assembly and inspection PDFs (MantelPDF). Part drawings as DXF (MantelDocs)                              |
| Manufacture | Jiga                                     | —                                                         | **Paused** (decided 2026-11-10). Jiga publishes no API; revisit with Jiga.                                      |

## Decisions already made

- Each phase's app is that phase's engine, not a viewer of something Mantel made.
- Every engine runs in the browser.
- Jiga is paused.
- An Art phase for logos and other artwork (requested 2026-11-10; backed by MantelArt, which already exists).

## Goals

1. **Open in the app, from the phase.** Every phase has an "Open in <App>" button. The app opens in Mantel, under Mantel's address and sign-in, with the phase's current file already loaded.
2. **Saves come back.** Saving in the app stores a new version of the file in the project on the server, and the phase updates. Nothing is downloaded by accident.
3. **The agent uses the same engine.** Each engine's headless CLI and MCP server runs in Mantel's isolated containers, so the agent edits the same files with the same commands a person does.
4. **One source of truth per phase.** The engine's file is the record. Previews, cards and summaries are derived from it and say which version they came from.
5. **Pinned versions.** Mantel serves a recorded commit of each app, so a change in an app repository never silently changes Mantel.

## Non-goals

- Jiga or any manufacturing service (paused).
- Migrating existing build123d models to MantelCAD. Existing models keep working as legacy models; new models use MantelCAD. _(my call)_
- Offline or desktop editions of the engines inside Mantel. The desktop apps keep working on their own.
- Collaborative real-time editing in an engine (two people in one file at once).

## Anti-goals

- **Two truths.** A phase whose state and its engine's file can disagree, such as a model whose Mantel parameters and MantelCAD design differ.
- **Silent loss on the way back.** A save that drops data the engine had (DXF entities, PDF annotations, Blender data) because Mantel stored a converted copy.
- **An app that drifts.** Serving an app's latest branch head instead of a pinned build.

## How it works

### Prerequisite: phases on the server

Phase data lives in the browser today. Engines save files, and the agent must see them, so phases move to D1 and R2 first. This adds tables for briefs, concepts, decisions, document states and their approvals, plus `phase_files` (`id, project_id, phase, kind, name, version, artifact_id, created_by, created_at, source_file_id`). Files go to R2 with checksums, as builds already do. Permission-checked tools in `src/server/tools.ts` serve both the UI and MCP. The browser store becomes a one-time import. Without this step nothing below can be shared or used by the agent.

### Hosting the browser builds

All five engines are Rust apps with WebAssembly builds made with Trunk: MantelPDF, MantelArt, MantelCAD, MantelDocs, and the new MantelMesh. Mantel serves each one at `/apps/<name>/` on its own origin. Same origin is required, because the apps' host bridge only talks to a same-origin parent.

- **Pinning:** an `apps.lock.json` records each app's repository, commit, build command and output checksum. A release workflow builds each app at its pinned commit and publishes the output with Mantel's assets. The app repositories are private, so the workflow needs read access. That means a fine-grained token or a deploy key stored as an Actions secret, and only the release job uses it.
- **Size:** Workers static assets allow 25 MiB per file. A larger `.wasm` is stored in R2 and streamed by the Worker under the same path. _(Results from the build test are below.)_
- **Headers:** the apps need correct `application/wasm` types and, where they use threads, cross-origin isolation headers on their paths only.

### The host bridge

MantelPDF and MantelDocs already implement the shared `craft-web-host` contract. Opened as `?host=parent` in a same-origin iframe, they work like this:

- The app sends `<app>:ready`.
- Mantel sends `<app>:open { name, bytes }`.
- Every save or export comes back as `<app>:save { name, saveAs, bytes }` instead of a download.
- `<app>:dirty` and `<app>:failed` report unsaved changes and startup errors.

Mantel adds one `EngineFrame` component that speaks this contract for every app. It takes the phase file, opens it, stores each save as a new `phase_files` version, guards leaving the page while the app is dirty, and shows failures. What the other two have today:

- **MantelArt** has no `?host=parent` bridge, but its page API (`window.vectorcraft`, from `craft-web-api`) already has `openFile(name, bytes)`, `captureDownloads(true)`, `files()` and `readFile(name)`. A same-origin parent can open a file and collect saves through the iframe's `contentWindow`. Adding the standard bridge in its repository is still preferred, so every engine speaks one contract.
- **MantelCAD** exposes `window.mantelcad` (`request`, `execute`, `commands`, `inspect`) over its control channel, but has no file bridge. Opening a design from bytes and handing saves to the host must be added in its repository.

The engine opens full-screen in Mantel's frame. The phase bar stays at the top with a "Back to <Phase>" chip, so it is always clear which project and phase you are in.

### Per phase

- **Brief → MantelPDF.** The structured brief stays Mantel's record, because the fields drive checks in later phases. MantelPDF owns the PDFs: the generated Design Specification, client markups of it, and the reference PDFs. Saving a marked-up PDF stores a new version, and the agent reads the annotations into proposed field changes, shown as proposals. _(my call: a PDF cannot hold the structured fields reliably.)_
- **Art → MantelArt.** One source file per piece of artwork. Exports (SVG and PDF) become the brief's logo and lettering files and the Model phase's artwork. An export says which source version it came from.
- **Concepts → MantelMesh.** See [MantelMesh in the browser](#mantelmesh-in-the-browser).
- **Model → MantelCAD.** A new model is a MantelCAD design file. Builds run `mantelcad-cli` headless in the existing isolated container, with no network, bounded time and immutable inputs, producing STEP, STL, GLB and the inspect record. The agent uses MantelCAD's MCP tools through Mantel's MCP, wrapped by Mantel's design sheet, change plans and guard. The Model phase's canvas, checks and output bar keep working from the derived files. "Open in MantelCAD" is the detailed editor.
- **Documents → MantelPDF and MantelDocs.** The blueprint adapter's DXF opens in MantelDocs, and edits save as a new drawing version tied to the model revision. Proof, assembly and inspection documents are PDFs opened in MantelPDF. Staleness rules are unchanged: a document version records the model revision and brief version it was made from.

### MantelMesh in the browser

Blender cannot run in a browser, so MantelMesh is rebuilt as a mesh modeller on the backend apps' stack: Rust to WebAssembly, `craft-libs` UI, and MantelCAD's shared viewport crates. Decided 2026-11-10; see [the MantelMesh design](2026-11-10-mantelmesh-design.md). Streaming a server-side Blender is not pursued.

## Order

Each item is its own plan and pull request, and the earlier ones unblock the later ones.

1. Phases on the server (D1, R2 and tools), with a browser-data import.
2. App hosting pipeline, `apps.lock.json` and `EngineFrame`, shipping **MantelDocs** and **MantelPDF** (their bridges already exist).
3. Host bridges in **MantelArt** and **MantelCAD** (their repositories), then add them to the lock file. Add the **Art** phase.
4. **MantelCAD as the Model engine:** container builds, agent tools and the canvas from derived files.
5. **MantelMesh:** the new browser mesh modeller, in its own repository, following its design's order. Its core can start in parallel with items 1–4.

## Calls I made (to check)

1. The structured brief stays Mantel's record, and MantelPDF owns the PDFs.
2. Existing build123d models stay as legacy models; only new models use MantelCAD.
3. The Art phase sits between Brief and Concepts.
4. Engines open full-screen inside Mantel, under the phase bar.
5. MantelMesh does not link MantelCAD's brand-licensed UI kit, look or theme.

## Open for the owner

- **MantelMesh repository and first-release focus** (see its design).
- **The MantelPDF rebrand** exists only as uncommitted work in the local checkout. Mantel should pin a pushed, branded commit.

## Validation

- Each engine opens a phase file in Mantel, saves, and the new version appears on the server and in the phase, in Chrome, Safari and Firefox at desktop size.
- A pinned build cannot change without a lock-file change in a reviewed PR.
- The agent edits a MantelCAD model headlessly and the person sees the same change in MantelCAD in the browser.
