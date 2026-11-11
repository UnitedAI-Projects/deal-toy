# Contributing to MantelCAD

MantelCAD development happens in [ichen27/mantelcad](https://github.com/ichen27/mantelcad). Keep each change focused and submit it on a feature or fix branch through a pull request. The upstream SolidCraft claiming, maintainer labels, merge queue, sponsorship, and release procedures do not apply to this repository.

## Setup and validation

Follow the [README quickstart](README.md#quickstart). Run `bash ci/run.sh` for the fork's required validation entry point. It checks branding, formatting, compilation, design-format migrations, and the file-format registry. Run `cargo xtask ci` for the broader inherited suite when making application, geometry, dependency, or cross-platform changes. Use targeted tests while developing, and report any check that could not run instead of treating it as passed.

For interface artwork run `cargo xtask icons` and `cargo xtask assets`; read [the asset instructions](assets/AGENTS.md) first. New strings go through the [localization workflow](docs/localization.md). Tests for changed behavior belong with the affected module.

## Architecture and compatibility

The applications are in `apps/`; shared modeling, document, I/O, rendering, and interface crates are in `crates/`. The included kernel is in `solidcore/`, and patched dependencies are in `vendor/`. Keep those upstream components and their notices separate from MantelCAD product branding. [Architecture](docs/architecture.md) and [layers](docs/layers.md) describe the dependency boundaries.

Every modeling action should use the command system so desktop, browser, CLI and MCP callers share behavior. Preserve explicit errors and hostile-input handling. The file-format tags and legacy extensions listed in [fork compatibility](docs/mantelcad-fork.md) are interoperability data; do not rename them as cosmetic cleanup. A format change needs a deliberate migration and tests.

## Review and merge

Describe the problem, resulting behavior, validation, and material risks. Include real screenshots for visible changes and small reproducible examples for geometry issues. Commit meaningful source and artifacts, and exclude secrets, private designs, dependencies, caches and build directories. Retain original licenses and attribution.

Push to the feature branch and open a PR against `main`. Review the diff and resolve actionable findings. Merge only after the current revision passes the relevant checks, any required reviews are satisfied, and conflicts are resolved. Never bypass a failed check. If account billing or plan limits prevent hosted checks or branch enforcement, report the blocker and keep the PR pending. Repository publication and releases are separate actions from source synchronization.

## Reporting a problem

Open a [MantelCAD issue](https://github.com/ichen27/mantelcad/issues) with your OS, build revision, steps, expected result, actual result and a minimal public-safe design or script. For suspected vulnerabilities, avoid publishing secrets or exploitable private data; follow [SECURITY.md](SECURITY.md).

## Licensing

Preserve the source's mixed licensing and all original notices. The modeling core uses MIT OR Apache-2.0; covered upstream interface, theme, look and brand material use `LICENSE-BRAND`. The project owner reports written permission for MantelCAD, as recorded in [fork provenance](docs/mantelcad-fork.md). Do not assume that this permission extends to every future change, distribution, or downstream use. Use original or appropriately licensed artwork, and record provenance in `ATTRIBUTION.md` or its pending rows. See [NOTICE](NOTICE) for third-party materials.
