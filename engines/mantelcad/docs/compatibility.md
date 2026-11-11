# File and application compatibility

MantelCAD is a separate derivative of SolidCraft, not an upgrade or renamed release of the upstream application. It retains the upstream CAD file formats while using its own executable names, settings, update repository and installer identity. See [fork provenance](mantelcad-fork.md) for the exact source revision and licensing context.

## 1. `.solvecraft` and `.solidcraft` design files

New designs use `.sc`. Existing `.solidcraft` and `.solvecraft` files remain readable, as do JSON designs. `crates/io/src/lib.rs` owns `DESIGN_EXTS`: `sc`, `solidcraft`, and `solvecraft`. Desktop/browser dialogs, CLI commands, MCP and component links use the common format registry.

Saving an opened legacy file keeps its existing filename. Save As and new designs offer `.sc`. Legacy filenames in test fixtures are intentional.

## 2. Serialized format tags

File contents retain their original format identities: `solidcraft/N`, `solidcraft-drawing/N`, `solidcraft-container/N`, `solidcraft-library/N`, `solidcraft-theme/N`, `solidcraft-shortcuts/1`, and `solidcraft-profile/1`. The existing readers continue accepting supported older `solvecraft` formats. The 3MF face-tag namespace remains unchanged.

These identifiers describe persisted formats, not the displayed application name. Rebranding does not introduce an incompatible file migration or claim that every newer upstream format is supported by this pinned source revision.

## 3. Environment variables

Use the `MANTELCAD_*` names documented by each command. Upstream `SOLIDCRAFT_*` and `SOLVECRAFT_*` variables are ignored, keeping recovery paths, control ports and runtime settings independent.

## 4. Settings, preferences, autosave and recovery folders

MantelCAD stores preferences under its own product identity and the `mantelcad.prefs` key. It does not automatically adopt SolidCraft/SolveCraft preferences, window state or autosaves. Desktop settings use the platform's per-user MantelCAD directory; recovery uses the MantelCAD data directory unless `MANTELCAD_RECOVERY_DIR` is explicitly set.

Browser OPFS files live under the `mantelcad` folder, with channel folders beneath it. Local-storage fallback keys use `mantelcad.file.*`, and other applications' keys are not read or deleted. Users can explicitly open exported designs from another application.

The inherited directory-copy utilities remain available in the source and their tests, but MantelCAD startup and recovery do not call them to adopt an upstream installation.

## 5. Installers and operating-system identity

The application ID is `com.ichen27.mantelcad`. Installer filenames and executables use MantelCAD / `mantelcad`; the CLI is `mantelcad-cli`. No `solvecraft-cli` executable alias is shipped.

- Windows uses a separate UpgradeCode and component identities. Design formats are offered through Open With, without replacing the upstream application's default file associations.
- macOS uses a separate bundle ID and registers the compatible design extensions.
- Linux packages do not declare that they replace or conflict with SolidCraft/SolveCraft. AppImage integration preserves upstream launchers, icons and commands.

## Linux app ID

Flatpak uses only the MantelCAD ID. Its packaging does not rebase upstream applications, grant access to their private data folders, or remove their desktop entries. There is no published MantelCAD Flatpak repository or Snap listing yet; see [downloads](downloads.md).

## MCP

Configure clients to launch `mantelcad-cli mcp` and use `mantelcad` as the connection label. A client configured for `solidcraft-cli` or `solvecraft-cli` is not silently redirected. The CAD command IDs and documented protocol behavior are retained; see [MCP](mcp.md) and [control protocol](control-protocol.md).

## Updates

The updater accepts release pages and assets only from `ichen27/mantelcad`. It never offers an upstream SolidCraft executable as a MantelCAD update. No MantelCAD release is published by this source rebrand.
