# Fork validation

Run `bash ci/run.sh` from a checkout with the README prerequisites. This is the same entry point used by `.github/workflows/checks.yml`.

The branding check validates application/package IDs, update ownership, required icon artifacts, the original interface license texts from the recorded source revision and retained legacy design identifiers. Its `--root` option permits testing a disposable fixture without changing the checkout. It returns a nonzero status for violations; an intentionally incorrect web-manifest product name was rejected during initial setup, and an altered interface license was rejected after updating to the current source base.

Rust validation checks formatting, desktop/CLI builds with the same CI profile used by the regression tests, design-format migration tests, file-format registry tests and updater tests. This scoped gate does not replace the larger upstream suite for geometry or broad behavioral changes; run `cargo xtask ci` as appropriate and report actual outcomes.

The workflow follows the shared CI standard's read-only permissions, pinned checkout action, nonpersisted checkout credentials, PR/default-branch/manual triggers, cancellation, stable `test` name and 45-minute cold-build timeout and two concurrent compiler jobs. It uses standard GitHub-hosted Ubuntu 24.04 workers and Rust 1.99.1. The initial native check required several minutes locally and the separate CI-profile kernel compilation is substantial; the build and tests now share one profile. A timeout is not a passing check.

There are no deployments, store uploads, mirrors, provider credentials or self-hosted workers in this workflow. Hosted billing availability and branch-protection enforcement are separate account settings and must be verified before claiming checks are enforced. The root `.github/workflows/` files are the active workflows; nested vendored source workflows do not execute for this repository.
