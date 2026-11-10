# MantelCAD fork provenance and compatibility

## Source base

MantelCAD derives from [tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft), revision [`f56114219b2d7f6d16de8dd58700479646948f8a`](https://github.com/tangency-labs/solidcraft/commit/f56114219b2d7f6d16de8dd58700479646948f8a), the latest upstream revision fetched for this rebrand on November 10, 2026.

The project owner explicitly selected this current revision and reported having written permission to use its interface material for MantelCAD. The permission document is not reproduced in this repository, and its specific scope or transferability is not established by this source record. This records the owner's statement; it does not grant permission to others or assert that every part of the application is permissively licensed.

The source has mixed licensing. Modeling/import/export/geometry code is covered by `LICENSE-MIT` or `LICENSE-APACHE`; the UI kit, look, theme and upstream brand material are separately covered by [LICENSE-BRAND](../LICENSE-BRAND). The original license texts remain unchanged, including `crates/ui-kit/LICENSE`, `crates/look/LICENSE`, and `crates/theme/LICENSE`. Third-party fonts and dependencies retain their own terms. Consult the applicable license and written permission before redistributing or reusing covered interface material.


The upstream Git history is retained for traceability. `origin` is the MantelCAD repository; `upstream` identifies the source repository. Do not push MantelCAD implementation work to upstream.

## Identity

| Surface | MantelCAD identity |
| --- | --- |
| Product | MantelCAD |
| Repository | `ichen27/mantelcad` |
| Desktop / CLI / web packages | `mantelcad`, `mantelcad-cli`, `mantelcad-web` |
| Shared crate prefix | `mantelcad-` |
| Application ID | `com.ichen27.mantelcad` |
| Environment variable prefix | `MANTELCAD_` |
| Brand artwork | [assets/branding](../assets/branding/README.md) |

Settings and application storage use the MantelCAD identity. Automatic update links must target MantelCAD releases rather than replace the application with an upstream SolidCraft build. No MantelCAD releases or hosted services are promised by the source rebrand.

## File compatibility

The CAD file formats retain their original wire identifiers, including `solidcraft/N`, `solidcraft-drawing/N`, `solidcraft-container/N`, and `solidcraft-library/N`. New designs continue to use `.sc`; legacy `.solidcraft` and `.solvecraft` designs remain recognized. These strings identify file formats, not the displayed application brand. Keeping them avoids an unnecessary incompatible format migration.

Names retained in original license notices, asset provenance, historical references, test fixtures, and the separately attributed SolidCore/vendor source are intentional. MantelCAD is not an official SolidCraft release and does not claim ownership of upstream contributions.

## Validation and release boundaries

`bash ci/run.sh` is the focused rebrand gate. The inherited `cargo xtask ci` covers broader checks and may require additional tooling and substantial build resources. The initial rebrand's exact results belong in its PR and validation report; the presence of workflow files alone does not establish a passing run.

Fork CI uses standard GitHub-hosted Ubuntu workers. Upstream publishing, mirrors, scheduled maintenance, store uploads, signing and sponsor workflows are removed from active `.github/workflows`; their original source remains in Git history. No provider credentials, deployment environments or self-hosted runners are required by fork CI. Hosted private-repository billing and branch-protection availability must be verified separately before claiming enforcement.

The inherited manuals contain historical platform and capability details. The [MantelCAD README](../README.md) and [downloads status](downloads.md) are authoritative for MantelCAD installation and availability. Existing upstream screenshots or reference measurements illustrate inherited behavior; they are not evidence of a newly validated MantelCAD build.
