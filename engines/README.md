# Engines

The apps that do each phase's real work. The browser apps open from their phases in Mantel and save editable files to the project. The imported CLI/MCP implementations are available in the source; Mantel's hosted build jobs and agent tools still use build123d. Wiring those to the new engines remains a separate step. See the [phase engines design](../docs/superpowers/specs/2026-11-10-phase-engines-design.md).

| Directory | App | Phase | Browser app | Imported from |
| --- | --- | --- | --- | --- |
| [`mantelpdf/`](mantelpdf/) | MantelPDF (PDF reader and editor) | Brief, Documents | `apps/pdfcraft-web` | [`ichen27/mantelpdf`](https://github.com/ichen27/mantelpdf) `main` at `0bffa42fc597` |
| [`mantelart/`](mantelart/) | MantelArt (vector illustration) | Art | `apps/vectorcraft-web` | [`ichen27/mantelart`](https://github.com/ichen27/mantelart) `feat/mantelart-branding` at `3c4a12eb505d` |
| [`mantelcad/`](mantelcad/) | MantelCAD (parametric CAD) | Model | `apps/mantelcad-web` | [`ichen27/mantelcad`](https://github.com/ichen27/mantelcad) `feat/mantelcad-latest` at `0051d334765b` |
| [`manteldocs/`](manteldocs/) | MantelDocs (2D drafting) | Documents (drawings) | `apps/manteldocs-web` | [`ichen27/manteldocs`](https://github.com/ichen27/manteldocs) `main` at `ea9884a1f05b` |
| [`mantelmesh/`](mantelmesh/) | MantelMesh (mesh modeller) | Concepts | `apps/mantelmesh-web` | New code, built here ([design](../docs/superpowers/specs/2026-11-10-mantelmesh-design.md)) |

Each directory is its own Cargo workspace and keeps its own README, AGENTS.md, licences, attribution and notices. The `.github/` folders inside them are kept for reference only; GitHub runs workflows from the repository root, where [`engines.yml`](../.github/workflows/engines.yml) tests and builds the engines whose files changed.

## Known state

- **MantelPDF** is imported from its pushed `main`, which still carries the upstream PDFCraft names. The MantelPDF rebrand is pushed in [upstream PR #1](https://github.com/ichen27/mantelpdf/pull/1), which remains open with a failing test check as of 2026-11-10. The import pin is unchanged; review and validate that PR before updating the subtree.
- **MantelArt's** prebuilt Mac preview (`artifacts/MantelArt-preview-macos-arm64.zip`, 86 MB in Git LFS) is not copied here. It stays in the MantelArt repository.
- **MantelCAD's** `crates/ui-kit`, `crates/look`, `crates/theme` and branding are under its [Brand and Interface Licence](mantelcad/LICENSE-BRAND). Their use in MantelCAD rests on written permission the owner reported. Other engines must not link them.

## Integration validation

The import pins above remain the provenance record; integration fixes are committed in this repository. Historical CAD fixtures keep their `.solidcraft` extensions, while current design fixtures use `.sc`. Corpus tests check that the historical collection is populated. MantelArt retains `.vectorcraft` as its native format.

The engines workflow runs desktop CAD tests serially because cold graphics-driver initialization can stall the socket-based daemon tests. The remaining workspace packages retain normal test parallelism. Failed runs retain compiled dependency caches and continue through the remaining test binaries, while still failing the job.

The CAD kernel is a nested workspace, so its shell regression tests run in the separate **mantelcad shell kernel** job. It checks analytic volumes and topology, boundary refusals, and the offset executive golden cases. To reproduce it from a fresh checkout, fetch the pinned data files (no upstream code is built):

```bash
(
  cd engines/mantelcad/solidcore
  source scripts/upstream-pin.env
  git init upstream
  git -C upstream remote add origin "$UPSTREAM_REPO"
  git -C upstream sparse-checkout set --no-cone '/TestFiles/pt_TestFiles/'
  git -C upstream fetch --filter=blob:none --depth 1 origin "$UPSTREAM_COMMIT"
  git -C upstream checkout --detach "$UPSTREAM_COMMIT"
)
bash engines/mantelcad/ci/test-shell-kernel.sh
```

If `upstream/` already exists, verify it is at the commit in `scripts/upstream-pin.env` and contains `TestFiles/pt_TestFiles` instead of initializing it again. These golden checks do not update expected results.

## Build a browser app

Some engines read pinned public inputs at build time. MantelPDF reads its translations from `storytold/craft-i18n` at the commit in `craft-i18n.rev`; without them it builds English-only and its language tests fail. Fetch them and export the variables first:

```bash
eval "$(bash engines/fetch-inputs.sh mantelpdf /tmp/engine-inputs | sed 's/^/export /')"
```


Needs Rust 1.99.1 with the `wasm32-unknown-unknown` target and Trunk 0.22.1.

```bash
bash engines/build-web.sh manteldocs
```

The output goes to `dist/apps/<engine>/`, built for the path `/apps/<engine>/` where Mantel serves it.

## Serve the engines in Mantel

Mantel serves each engine at `/apps/<engine>/` to signed-in people, from R2 under `apps/<engine>/<tree>/`. `<tree>` is the Git tree of `engines/<engine>`, and `apps/manifest.json` names the tree each engine serves. The deploy workflow builds and uploads an engine only when its tree has no upload yet, and switches the manifest after deploying the Worker.

Phases open an engine with `EngineFrame`:

- **MantelDocs, MantelPDF and MantelMesh** use the Craft host bridge (`?host=parent`, `<app>:ready/open/save`).
- **MantelArt** is driven through its page API (`window.vectorcraft`).
- **MantelCAD** runs as its editing embed (`?embed=editor`). Designs move through `window.mantelcad`: `document.export` and `document.import` carry the design's JSON, saved as `.sc`, and `document.saved` marks it saved. STEP files open from their URL (`&open=`).

Every save becomes a new phase file.

To run them locally with `npm run dev`, build an engine, upload it to the local R2 and write the manifest:

```bash
bash engines/build-web.sh manteldocs /tmp/manteldocs-web
node engines/publish-web.mjs upload manteldocs /tmp/manteldocs-web "$(git rev-parse HEAD:engines/manteldocs)" --local
node engines/publish-web.mjs manifest manteldocs="$(git rev-parse HEAD:engines/manteldocs)" --local
```

Build sizes as of 2026-11-10 (`.wasm`, uncompressed): MantelCAD 153 MB, MantelArt 91 MB, MantelPDF 45 MB, MantelDocs 30 MB and MantelMesh 4.6 MB. Served compressed and cached by content hash, the first load of MantelCAD is still around 47 MB.

## Update an engine from its source repository

```bash
git subtree pull --prefix=engines/mantelcad https://github.com/ichen27/mantelcad feat/mantelcad-latest --squash
```

Then update the commit in the table above, run that engine's tests, and open a PR. Changes made here can be sent back with `git subtree push`.
