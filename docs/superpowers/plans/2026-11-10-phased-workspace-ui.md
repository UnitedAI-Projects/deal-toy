# Phased workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five-phase project workspace usable in the real app. The phase bar, Brief, Concepts, Documents and Manufacture screens, the agent panel and the output bar all work, and Model stays the existing workspace.

**Architecture:** This is frontend only, at the owner's request ("get the UI and user experience up and running first"). A pure module `src/web/phases.ts` holds the phase state, progress, approvals and staleness rules, with unit tests. `src/web/phase-store.ts` keeps that state per project in browser storage, a stand-in until the data-model design lands. `ProjectShell.tsx` replaces the direct `Workspace` render in `main.tsx`. For Model it renders `Workspace` with a phase bar and an output bar passed in. For the other phases it renders the shared frame and that phase's screen.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, existing `style.css` tokens.

**Spec:** `docs/superpowers/specs/2026-11-10-phased-project-workspace-design.md`

## Global Constraints

- Keep the look: the existing tokens, `.chip` pills and glass cards. Indigo (`--agent`) marks agent activity only.
- The agent never approves. Every approval is a button a person clicks, recording `by` (the signed-in email) and `at` (ISO time).
- Phases are never locked. A phase whose inputs are not approved shows a banner, not a wall.
- Be honest about what is not connected. Concept generation, the built-in agent and the manufacturing service do not exist yet. Their controls are disabled with a reason, or labelled "saved here, not sent".
- Browser storage can be missing or full. The app must still render, and a failed save shows an error instead of failing silently.
- Desktop 1440 × 900 and phone 390 × 844, in light and dark themes.

## Review Focus

- **Storage unavailable or over quota** (a private window, or a large reference image). Expect the state to stay in memory and a visible "Not saved: …" message. Test: `savePhases` returns `{ ok: false }` when `setItem` throws.
- **A project with no model or no revision.** Expect Documents to say there is no revision yet and Create release to stay disabled. Test: `releaseReady` with `latestRevision` 0.
- **Editing an approved brief.** Expect the version to rise once, not on every keystroke, and downstream outputs to turn stale only after the new version is approved. Tests: `editBriefField` twice keeps v2, and `phaseStatus` turns concepts stale after the v2 approval.
- **Approving with open required fields.** Expect it to be refused with the field names. Test: `approveBrief` throws naming the fields.
- **Envelope text in odd formats** ("220x90x200", "220 × 90 × 200 mm max", blank). Expect warnings only when three numbers parse. Test: `conceptWarnings`.

---

### Task 1: Phase state and rules

**Files:**

- Create: `src/web/phases.ts`, `src/web/phases.test.ts`, `src/web/phase-store.ts`, `src/web/phase-store.test.ts`

**Interfaces:**

- Produces (`phases.ts`): `PhaseId`, `PHASES: { id: PhaseId; label: string }[]` (Brief, Concepts, Model, Documents, Manufacture), `BriefField { key, section, label, required, value, state: "answered" | "assumed" | "open" | "na", source: "you" | "agent" | "file", note? }`, `BriefFile { id, name, type, size, field, dataUrl? }`, `Approval { by, at }`, `Brief { version, fields, files, approved?: Approval & { version, fields } }`, `Concept { id, name, size, materials, components, notes, image?, starred, discarded, createdAt }`, `Question { id, text, owner: "client" | "maker" | "model", resolved?: Approval }`, `ConceptDecision`, `DocKind` (`proof | drawings | parts | assembly | files | inspection | revisions`), `DOCS: { kind, title }[]`, `DocState { kind, content, approved?: Approval & { revision, briefVersion } }`, `Supplier`, `OrderStage`, `PhaseState`.
- Functions: `emptyPhaseState()`, `briefProgress(b) → { required, answered, assumed: string[], open: string[] }`, `editBriefField(s, key, patch)`, `approveBrief(s, by, at)` (throws `Error("Still open: Logos, Box")`), `approvedBriefVersion(s) → number`, `briefChanges(s) → string[]`, `phaseStatus(s, phase, latestRevision) → "none" | "active" | "approved" | "stale"`, `conceptWarnings(c, s) → string[]`, `docStatus(d, latestRevision, briefVersion) → "empty" | "draft" | "approved" | "stale"`, `releaseReady(s, latestRevision) → { ready, reasons }`, `agentGuide(s, phase, latestRevision) → { text, suggestions: string[] }`.
- Produces (`phase-store.ts`): `loadPhases(projectId, storage?) → PhaseState`, `savePhases(projectId, s, storage?) → { ok: true } | { ok: false; reason }`, `usePhases(projectId) → [PhaseState, (fn) => void, string]`. The key is `mantel.phases.v1.<projectId>`.

Rules to pin:

- The brief template sections and fields come from the spec's table. Required fields: deal, date, quantity, budget, deadline, logos, envelope, primary material, finish, subject, assembly look, fragile details and box.
- Versioning: a brief starts at v1. Approving copies the fields into `approved`. The first edit after approval sets `version = approved.version + 1`, and later edits keep it there.
- Staleness: concepts are stale when `decision.briefVersion < approvedBriefVersion`. Model is stale when `modelReady.revision < latestRevision` or its brief version is older. A document is stale when `approved.revision < latestRevision` or `approved.briefVersion < approvedBriefVersion`. Documents are stale when the release is out of date in the same way.
- `conceptWarnings`: take the first three numbers of the envelope field and of the concept's size. For each dimension where the concept is larger, return "Wider than", "Deeper than" or "Taller than", followed by "the {W} × {D} × {H} mm envelope (brief v{n})".

- [ ] Write the tests for the Review Focus cases above, plus: the empty state has 13 required fields; `approveBrief` succeeds when none are open; `docStatus` gives stale for an r6 approval at r7; `releaseReady` lists missing documents by title; `agentGuide` in Brief names the first open required field.
- [ ] Run `npx vitest run src/web/phases.test.ts src/web/phase-store.test.ts` and confirm it fails.
- [ ] Implement both modules. The store takes an injectable `Storage` for tests and wraps every access in try/catch.
- [ ] Run the tests and confirm they pass, then commit.

### Task 2: Shell, phase bar, output bar and agent panel

**Files:**

- Create: `src/web/ProjectShell.tsx`, `src/web/PhaseFrame.tsx` (phase bar, output bar and agent panel components)
- Modify: `src/web/main.tsx` (render `ProjectShell` instead of `Workspace`), `src/web/Workspace.tsx` (optional props `phaseBar?: ReactNode` and `outputBar?: ReactNode`, plus the `with-phases` class on `.workspace`), and `src/web/style.css`

**Interfaces:**

- `ProjectShell` takes the same props as `Workspace`. Its phase lives in the URL hash (`#brief` and so on), defaults to Brief for a new project and to Model when the project already has a revision and no brief has been touched.
- `PhaseBar { state, phase, latestRevision, onChoose }`. `OutputBar { children }`. `PhaseAgent { phase, state, latestRevision, projectId, onSuggestion }` sends notes with `call("notes_add", { projectId, message })`. It says that notes reach connected agents on their next tool call and that the built-in agent is not connected yet.
- In Model, `.with-phases` moves `.cadbar` to `top: 60px` and lifts `.revisions` and `.timeline` above the output bar.

- [ ] Build these pieces, then open a project, switch through all five phases and check that Model still builds, selects and edits as before.
- [ ] Run `bash ci/run.sh` and commit.

### Task 3: Brief screen

**Files:** create `src/web/BriefPhase.tsx`.

- Sections with fields that edit in place, the source and state tags, ✓ Confirm on agent or assumed values, an N/A toggle, a section index, file drop and attach (logos go to the Logos field, with a raster warning when the file is not .svg, .eps, .ai or .pdf), the "v2 draft · v1 approved by … · 2 fields changed" header, and an output bar with Approve brief (disabled with the open field names) and an approval dialog that lists assumed fields.
- [ ] Build it, check it in the browser, and commit.

### Task 4: Concepts screen

**Files:** create `src/web/ConceptsPhase.tsx`.

- A board of dashed concept cards. New concept opens a form with a name, rough size, materials and components. Sketch opens a canvas pad and saves a PNG data URL. Reference uploads an image (under 1.5 MB). Generate is disabled with "Concept generation isn't connected yet". Cards can be starred, discarded and restored from the tray, and show brief warnings.
- Choose opens a decision sheet with qualities as checkboxes, targets, open questions with owners, and a brief-conflict callout with Update brief, which jumps to Brief. Saving it records `decision` with the approved brief version.
- [ ] Build it, check it in the browser, and commit.

### Task 5: Documents and Manufacture screens

**Files:** create `src/web/DocumentsPhase.tsx` and `src/web/ManufacturePhase.tsx`.

- **Documents:** a list of `DOCS` with each one's status, and a preview. The customer proof is built from the brief and the latest revision. Part drawings and manufacturing files list the latest successful build's real artifacts, with downloads. The revision summary comes from `data.revisions`. Parts list, assembly and inspection are editable drafts. A "Built from" strip, Approve per document, stale banners, and Create release gated by `releaseReady`.
- **Manufacture:** suppliers added by hand with quotes, threads whose messages are labelled "saved here, not sent: no manufacturing service is connected", an order stage stepper set by a person, and a banner when the release is missing or stale.
- [ ] Build them, check them in the browser, and commit.

### Task 6: Library strip, docs and delivery

- Five phase dots on each project card in `main.tsx`.
- Update the README status paragraph and `docs/roadmap.md` to say what is real and what is a stand-in.
- Take screenshots of every phase at desktop and phone sizes, in both themes, into `docs/images/phases-*.png`.
- [ ] Run `bash ci/run.sh`, push, open a PR, and wait for green checks.
