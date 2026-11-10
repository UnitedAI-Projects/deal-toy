# MantelCAD artifacts

The source tree contains the editable inputs and production exports needed to build MantelCAD. Repository-relative links work in a checkout and on GitHub with repository access.

| Artifact | Format and purpose | How to use |
| --- | --- | --- |
| [Brand kit](../assets/branding/README.md) | MantelCAD SVG masters and PNG exports | Use the SVG masters for editing and print; PNGs for raster-only consumers. |
| [Application icon sources](../assets/icons/app/shared/source/) | Rust source for the app mark and Windows ICO encoder | Shared authority for desktop and package exports; see [resources](../assets/README.md). |
| [macOS icon source](../assets/icons/app/macos/source/) | Native Icon Composer project and linked SVG artwork | Open with compatible Xcode/Icon Composer tooling. |
| [Linux icons](../assets/icons/app/linux/exports/hicolor/) | PNG exports at package-consumed sizes | Used by Linux/FreeBSD packaging and browser metadata. |
| [Windows icons](../assets/icons/app/windows/exports/) | ICO exports | Used by executable and installer packaging. |
| [macOS icon exports](../assets/icons/app/macos/exports/) | ICNS and compiled asset catalog | Used by macOS packaging. |
| [Social preview](../assets/branding/web/source/og.png) | PNG | Preview card for documentation or future publishing. |
| [Bracket example](../examples/bracket.json) | Editable command JSON | Run the README's CLI example to export STEP or a preview. |
| [Additional examples](../examples/) | Command scripts and demonstration inputs | See each example's instructions and the [script format](scripts.md). |
| [Upstream licenses and attribution](../NOTICE) | Text and Markdown | Mixed licensing and source/asset provenance; preserve all notices. |
| [Interface license](../LICENSE-BRAND) | Original license text | Covers the upstream UI kit, look, theme and brand material; see the owner-reported permission scope in fork provenance. |
| [Interface icon sources](../crates/look/icons/) | SVG masters, style guide and authoring tools | Retained upstream interface material under its documented license and permission terms. |
| [Fork provenance](mantelcad-fork.md) | Markdown | Records the exact source base, license boundary and compatibility choices. |

Compiled application binaries, dependency caches and build staging directories are not committed. There is no published MantelCAD binary release yet. Any screenshots or verification outputs added for this fork should identify the tested revision and remain distinct from inherited upstream demonstrations.
