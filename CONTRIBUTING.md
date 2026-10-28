# Contributing

Use Node 24 and Python 3.12. Follow the README quickstart, branch from current `main`, and keep changes focused. Source and intended demonstration artifacts belong in Git; credentials, local state and customer designs do not.

Run `bash ci/run.sh`. Runtime changes also require a Linux container build and `bash ci/container-smoke.sh`. UI changes need desktop/mobile browser verification and screenshots without private data. New actions need ownership, validation, denial and failure-path tests. Keep documentation aligned with actual behavior.

Open a PR describing the problem, resulting behavior, evidence, remaining gaps and migration/release effects. Passing current-revision tests and applicable reviews are required before merge. Deploy only through the separate production workflow. Do not change billing, visibility or branch protection to make failing work pass.

For issues, include a minimal synthetic source, expected/actual behavior, runtime versions and reproducible steps. Do not include personal tokens, customer briefs, confidential transaction details or private logs.
