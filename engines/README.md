# Engines

The apps that do each phase's real work. Each one runs in the browser, opened from its phase in Mantel, and headless through its CLI and MCP server for agents. See the [phase engines design](../docs/superpowers/specs/2026-11-10-phase-engines-design.md).

| Directory | App | Phase | Browser app | Imported from |
| --- | --- | --- | --- | --- |
| [`mantelpdf/`](mantelpdf/) | MantelPDF (PDF reader and editor) | Brief, Documents | `apps/pdfcraft-web` | [`ichen27/mantelpdf`](https://github.com/ichen27/mantelpdf) `main` at `0bffa42fc597` |
| [`mantelart/`](mantelart/) | MantelArt (vector illustration) | Art | `apps/vectorcraft-web` | [`ichen27/mantelart`](https://github.com/ichen27/mantelart) `feat/mantelart-branding` at `3c4a12eb505d` |
| [`mantelcad/`](mantelcad/) | MantelCAD (parametric CAD) | Model | `apps/mantelcad-web` | [`ichen27/mantelcad`](https://github.com/ichen27/mantelcad) `feat/mantelcad-latest` at `0051d334765b` |
| [`manteldocs/`](manteldocs/) | MantelDocs (2D drafting) | Documents (drawings) | `apps/manteldocs-web` | [`ichen27/manteldocs`](https://github.com/ichen27/manteldocs) `main` at `ea9884a1f05b` |
| `mantelmesh/` | MantelMesh (mesh modeller) | Concepts | planned | New code, built here ([design](../docs/superpowers/specs/2026-11-10-mantelmesh-design.md)) |

Each directory is its own Cargo workspace and keeps its own README, AGENTS.md, licences, attribution and notices. The `.github/` folders inside them are kept for reference only; GitHub runs workflows from the repository root, where [`engines.yml`](../.github/workflows/engines.yml) tests and builds the engines whose files changed.

## Known state

- **MantelPDF** is imported from its pushed `main`, which still carries the upstream PDFCraft names. The MantelPDF rebrand exists only as uncommitted work in another checkout. Import it with a subtree pull once it is pushed.
- **MantelArt's** prebuilt Mac preview (`artifacts/MantelArt-preview-macos-arm64.zip`, 86 MB in Git LFS) is not copied here. It stays in the MantelArt repository.
- **MantelCAD's** `crates/ui-kit`, `crates/look`, `crates/theme` and branding are under its [Brand and Interface Licence](mantelcad/LICENSE-BRAND). Their use in MantelCAD rests on written permission the owner reported. Other engines must not link them.

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

- **MantelDocs and MantelPDF** use the Craft host bridge (`?host=parent`, `<app>:ready/open/save`).
- **MantelArt** is driven through its page API (`window.vectorcraft`).
- **MantelCAD** opens without a file bridge for now.

Every save becomes a new phase file.

To run them locally with `npm run dev`, build an engine, upload it to the local R2 and write the manifest:

```bash
bash engines/build-web.sh manteldocs /tmp/manteldocs-web
node engines/publish-web.mjs upload manteldocs /tmp/manteldocs-web "$(git rev-parse HEAD:engines/manteldocs)" --local
node engines/publish-web.mjs manifest manteldocs="$(git rev-parse HEAD:engines/manteldocs)" --local
```

Build sizes as of 2026-11-10 (`.wasm`, uncompressed): MantelCAD 153 MB, MantelArt 91 MB, MantelPDF 45 MB and MantelDocs 30 MB. Served compressed and cached by content hash, the first load of MantelCAD is still around 47 MB.

## Update an engine from its source repository

```bash
git subtree pull --prefix=engines/mantelcad https://github.com/ichen27/mantelcad feat/mantelcad-latest --squash
```

Then update the commit in the table above, run that engine's tests, and open a PR. Changes made here can be sent back with `git subtree push`.
