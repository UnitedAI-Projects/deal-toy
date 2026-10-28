# Validation and rollout record

2026-10-27, initial foundation. This record separates implementation, local validation, hosted checks and deployment.

## Local evidence

- Thirteen Worker integration tests pass: identity and token handling, anonymous denial, project ownership, immutable revisions, concurrent-write conflicts, cross-project document references, document versioning, administrator-only tool configuration, disabled tools, cross-origin denial, MCP initialization, duplicate build delivery, export persistence and partial-export cleanup.
- Five native Python tests pass: real OCCT construction and STEP round-trip geometry, GLB/STL outputs, invalid-model refusal, timeout termination and source-size limits.
- TypeScript checks, production browser build, Python lint and npm dependency audit pass. Worker packaging dry-run passes independently of the native image test.
- The initial Linux ARM64 container built and exported STEP/STL/GLB/facts with networking disabled, a read-only filesystem and bounded memory/processes. The final image removes redundant uv package-cache data and completed the full browser-to-queue-to-container build successfully.
- Browser verification on the development host: authenticated project creation, immutable source save, failed-job display, interrupted-job expiration and revision-linked manufacturing brief persistence. Successful queued build and 3D viewing were verified; the authenticated downloaded STEP was re-imported and measured at 100 × 55 × 51 mm and 62,900 mm³. MCP projects_list returned the saved project. Skill publication and project-wide/revision-linked document versions were verified. The mobile workspace and document flow were checked at 390 × 844 with no horizontal page overflow. Screenshots are in docs/images. This was tested on the development host; MacBook access has not been verified.

The local Docker backend exhausted its internal-disk space while starting a container. Only this task's known image and build-cache records were removed. Other projects' Docker resources were preserved. The image now avoids retaining the uv download cache. [Hosted Linux AMD64 checks passed](https://github.com/UnitedAI-Projects/deal-toy/actions/runs/40626920530), including the native container build and network-disabled export smoke test.

## Cloudflare and GitHub setup

- Repository: private `UnitedAI-Projects/deal-toy`, originally empty. A documentation-only main branch was initialized; implementation stays on `feat/cad-workspace-foundation`.
- Existing personal Cloudflare account verified. Dedicated D1 `deal-toy` (`01262ea9-4640-464f-870c-2c7618f5fb5a`), private R2 `deal-toy-artifacts`, and Queue `deal-toy-builds` created. No customer data is present.
- GitHub production environment created and restricted to main. Account ID is configured as an environment secret. `DEPLOY_ENABLED=false` while activation is incomplete.
- Dedicated Cloudflare CI API token, application URL, production membership and browser Access setup are not configured. No production deployment or live CAD acceptance is claimed.
- GitHub Actions is enabled. The organization billing-usage API was unavailable to the current credential; the hosted run executed successfully. Usage limits may still apply to later runs.

- Branch protection was rejected by GitHub with HTTP 403 because the current plan does not support it for this private repository. CI exists, but required-check enforcement is unavailable. Keep the repository private.

Implementation is pushed in [PR #1](https://github.com/UnitedAI-Projects/deal-toy/pull/1). The initial hosted run passed; the final revision adds build lifecycle regression coverage and aligns queue concurrency with the two-container limit. Its checks must pass before merging. Production activation remains pending a dedicated deployment token and live acceptance.
