# Deal Toy contributor guide

Repository: `UnitedAI-Projects/deal-toy`. Build the internal CAD workspace for a service company producing physical deal toys. Keep project data private.

## Boundaries

- `src/server/tools.ts` owns typed business operations shared by HTTP and MCP. Every operation enforces identity, project ownership and current tool enablement.
- `src/server/builds.ts` owns queued execution and artifact persistence. `engine/` contains the isolated Python/build123d runtime. Preserve one job per container, disabled egress, no credentials, bounded execution, and immutable inputs.
- `src/web/` owns the project library, modeling workspace and extension interface. Native CAD runs in containers; the browser displays derived GLB geometry.
- `skills/` contains workflow guidance. Skills cannot grant permissions. New executable tools require implementation, tests and deployment; Markdown cannot install code.

Before changing contracts, persistence or deployment, read `docs/architecture.md` and `docs/deployment.md`. Before adding drawing or handoff features, read `docs/manufacturing.md`. Use `docs/roadmap.md` to distinguish current functionality from planned capabilities.

## Delivery

Work on a focused branch. Preserve existing edits. Run `bash ci/run.sh` and the container smoke test for runtime changes. Verify UI changes at desktop and mobile sizes. Keep synthetic, editable examples and their useful exports in the repository.

Open a PR, review the diff, resolve findings and pass current-revision checks. Production uses the separate deployment workflow; PR jobs have no production credentials. There is no agent runner or advisory AI review in CI. Never bypass required checks or change repository visibility to solve billing limitations.

Commit as `ichen27 <ivan27chen@gmail.com>`. Preserve dependency licenses and attribution. Report pushed, reviewed, merged and deployed as distinct states. Update validation evidence and material limitations accurately.
