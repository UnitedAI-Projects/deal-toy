---
name: mantelcad-packaging
description: "Use when preparing MantelCAD installers or packages, changing package metadata and release asset names, or publishing an explicitly authorized release."
---

# Packaging and releases

MantelCAD is distributed as source; `docs/downloads.md` records current availability. The active `.github/workflows/checks.yml` validates source through `ci/run.sh`. It does not build releases, publish containers, upload stores, deploy Pages or sign applications. A push or tag is not a release.

## Prepare and validate

1. Read the target platform's script in `packaging/` for prerequisites and supported arguments. Read `docs/mantelcad-fork.md` for mixed licensing and the owner-reported permission scope before distribution.
2. Select a version appropriate to the change. Update the workspace version and lockfile together; `cargo update --workspace --offline` must not introduce unrelated dependency changes. A major-version decision belongs to the owner.
3. For a release that folds pending design changes, follow `skills/mantelcad-file-formats/SKILL.md` and `scripts/fold-format-pending.sh`; revalidate compatibility afterward.
4. Run `bash ci/run.sh`, relevant broad checks from `cargo xtask ci`, and `python3 -m unittest discover -s packaging/tests -p '*_test.py'`. Package scripts require their own platform validation; passing source tests does not establish that installers work.
5. Land the reviewed source through the PR workflow in `CONTRIBUTING.md` before a release is prepared from that exact revision.

## Build locally

- Linux: `bash packaging/linux/package.sh --formats tar` builds a tar package. Read its header before selecting AppImage/deb/rpm, which need additional tools.
- macOS: `bash packaging/macos/package.sh --arch aarch64` builds for Apple silicon. Read the script for Intel/universal builds and its signing options. Without supplied and verified signing credentials, do not claim Developer ID signing or notarization.
- Windows: read `packaging/windows/package.ps1` and invoke it with its supported parameters from a suitable Windows build environment.
- Browser: `apps/mantelcad-web/Trunk.toml` defines the build. Docker Compose in `packaging/docker/compose.yaml` builds a local image; no registry image is promised.

Build outputs belong in the script's staging/output directories. Verify package names, included licenses, checksums, install/open behavior, CLI version and a representative model on each claimed platform. Record exact revision and observed signing status. Keep intended deliverables with versioned artifact links rather than treating them as caches.

## Publish only the verified result

An explicitly authorized publication may upload verified packages to a draft release in `ichen27/mantelcad`. Review that draft, checksums, revision and platform coverage before making it public. Preparing a package does not authorize publication. Do not overwrite a published version or silently substitute upstream binaries.

The updater in `crates/ui-egui/src/update.rs` expects MantelCAD repository URLs and package names; keep those consistent with release artifacts. Preserve original license/provenance names and interoperable file-format identifiers. Signing, stores and web hosting need separate configuration and acceptance; inherited upstream release documentation is not evidence that they are configured here.
