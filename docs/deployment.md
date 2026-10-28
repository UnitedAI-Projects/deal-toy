# Deployment and operations

## CI

`Checks` runs on PRs, main pushes and manual dispatch. Its stable required job is `test`. It uses hosted Linux, read-only repository permissions, pinned Actions, lockfiles, no persisted checkout credentials and a fifteen-minute timeout. `ci/run.sh` is the shared local/remote validation entry point. The native container smoke test exercises real export generation with networking disabled.

There is no agent runner, provider key or advisory AI review. GitHub-hosted private compute availability and branch protection depend on the organization plan. A billing refusal is an infrastructure block, not a failed executed test; resolve it without changing visibility or bypassing checks.

## Cloudflare resources

Create a dedicated D1 database, R2 bucket and queue, then set their identifiers in `wrangler.jsonc`. Keep them separate from Slice. The Worker name is `unitedai-deal-toy`. The runtime uses at most two simultaneous containers. Native jobs are Linux/amd64 in production; local Apple Silicon testing is useful but does not replace hosted amd64 verification.

```sh
npx wrangler d1 create deal-toy
npx wrangler r2 bucket create deal-toy-artifacts
npx wrangler queues create deal-toy-builds
```

The Cloudflare account must support Workers Paid and Containers. Provisioning metadata does not establish that the CAD runtime has been deployed or verified. Inspect recorded live resource status in `docs/validation.md` before repeating creation.

## Production workflow

Create a `production` GitHub environment restricted to `main`. Set:

- Environment secrets `CLOUDFLARE_ACCOUNT_ID` and a deployment-specific `CLOUDFLARE_API_TOKEN` scoped to this account and the Worker/Containers, D1, R2 and Queues operations the deployment requires.
- Repository variable `APP_URL` to the deployed HTTPS origin.
- Repository variable `DEPLOY_ENABLED=true` only after credentials/resources and identity are configured.

Never put a personal Wrangler OAuth token into CI. Use a dedicated API token with an appropriate expiration and rotation plan. Keep deployment credentials out of PR checks.

`Deploy` reruns the full checks on the selected main revision, verifies main has not advanced, applies forward migrations, and deploys the Worker and native image. It verifies the running release SHA and anonymous API denial. Initial container provisioning may take several minutes; perform authenticated CAD acceptance separately. Failed migrations or deploy verification remain failed jobs; there is no automatic rollback.

## Identity

The app denies private API access by default. For Cloudflare Access browser sign-in, configure an Access application and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` to its verified issuer/audience. Membership remains a separate check. Do not trust an email header alone.

Provision a member and personal token using `node ci/member.mjs --remote person@example.com maker /private/token.txt`. An administrator role can publish global skills and configure tools. The script writes the token once to a private file; it stores only the hash in D1. Deliver the token privately. To revoke, delete its hash from `tokens`, or set the member's `active=0` to revoke all their tokens and Access sessions. Tokens expire after ninety days.

No members or tokens are seeded in production automatically. Project sharing and OAuth client consent are not implemented.

## Rollback and recovery

For normal rollback, revert the faulty change in a PR, pass checks, merge and redeploy. This rolls forward from known source and includes the corresponding native image. Worker-only version rollback may not restore the container image and never restores D1/R2 data; do not claim it is a full application rollback.

Use additive migrations. Before a destructive schema change, add a backup/restore plan and exercise restoration. Preserve the successful deployment run and release SHA for incident records. Queue jobs stuck queued/running become failed after fifteen minutes; a new explicit build retries the same immutable revision. Successful exports remain in R2 after containers stop.

## Local runtime caveat

Wrangler's Docker development runtime may use development-only container privileges such as SYS_ADMIN/FUSE. Use trusted synthetic models during local development; do not treat the local Docker setup as proof of the deployed isolation boundary. Live Cloudflare runtime acceptance must check the production configuration separately.
