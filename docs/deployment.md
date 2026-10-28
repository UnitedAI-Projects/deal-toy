# Deployment and operations

## CI

`Checks` runs on PRs, main pushes and manual dispatch. Its stable required job is `test`. It uses hosted Linux, read-only repository permissions, pinned Actions, lockfiles, no persisted checkout credentials and a fifteen-minute timeout. `ci/run.sh` is the shared local/remote validation entry point. The native container smoke test exercises real export generation with networking disabled.

There is no agent runner, provider key or advisory AI review. GitHub-hosted private compute availability and branch protection depend on the organization plan. A billing refusal is an infrastructure block, not a failed executed test; resolve it without changing visibility or bypassing checks.

## Cloudflare resources

Create a dedicated D1 database, R2 bucket and queue, then set their identifiers in `wrangler.jsonc`. Keep them separate from Slice. The Worker name is `unitedai-deal-toy`. Queue concurrency is limited to two jobs. Native jobs are Linux/amd64 in production; local Apple Silicon testing is useful but does not replace hosted amd64 verification.

The account requires the `durable_object` container scheduling policy. Wrangler builds the named `cad` image; each job selects its version-pinned image and `standard-1` size at startup, with internet disabled. Readiness has a sixty-second deadline, and a persistent three-minute alarm destroys abandoned containers. This policy does not support an application-level `max_instances` cap; queue concurrency and account limits bound normal execution. See [Cloudflare scheduling policies](https://developers.cloudflare.com/containers/configuration/scheduling-policy/).

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

`Deploy` reruns the full checks on the selected main revision, verifies main has not advanced, applies forward migrations, and deploys the Worker and native image. It verifies the running release SHA, anonymous API and MCP denial, and the Google sign-in redirect. Initial container provisioning may take several minutes; perform authenticated CAD acceptance separately. Failed migrations or deploy verification remain failed jobs; there is no automatic rollback.

## Identity

Mantel signs people in itself, with Google. Cloudflare Access is no longer required; see the cutover below.

### Google OAuth client (owner setup, once per environment)

1. In Google Cloud Console → **APIs & Services → Credentials**, create an **OAuth client ID** of type **Web application**. The consent screen needs only the `openid`, `email` and `profile` scopes.
2. Add the authorized redirect URI `https://unitedai-deal-toy.ivan27chen.workers.dev/api/auth/google/callback` (and `http://localhost:8787/api/auth/google/callback` for a development client).
3. Put the client ID in `GOOGLE_CLIENT_ID` in `wrangler.jsonc` (an identifier, not a secret) and store the secret with `npx wrangler secret put GOOGLE_CLIENT_SECRET`. Never commit the secret.
4. Until both are set, the sign-in button reports "Google sign-in isn't set up yet" and the release check prints a warning.

Production uses Google Cloud project `unitedai-mantel-prod` (Mantel), with the **Mantel production** web client. Its public client ID is recorded in `wrangler.jsonc`; its secret is stored only as the Worker secret `GOOGLE_CLIENT_SECRET`. Google publishing also requires a public application homepage and privacy-policy link. Basic identity scopes do not remove branding requirements. The proposed [privacy policy](privacy-policy-draft.md) is an unpublished draft requiring owner review. Keep the existing Access gate until the owner has verified the new sign-in path.

`AUTH_LIMITER` (Workers rate limiting, 20 requests a minute per IP) protects the Google start and callback routes. `DAILY_BUILD_LIMIT` (default 100) caps builds per member per day.

### Members, owners and recovery

The accounts migration (`0003_accounts.sql`) turned existing administrators into owners at the Admin level and makers into the Maker level, and moved existing personal tokens into API keys named after their label. New people sign up with Google and start at the default level (Demo). Owners manage everyone else in **Settings**.

If an owner loses access to their Google account, restore it with `node ci/member.mjs --remote person@example.com owner /private/link.txt https://unitedai-deal-toy.ivan27chen.workers.dev`, using a Wrangler login with D1 write access. The script writes a single-use, 15-minute sign-in link to the private file and stores only its hash. Open it on the person's own computer.

### Accounts migration recovery

Before merging the accounts release, export D1 to a private, ignored location and record a current Time Travel bookmark. The migration drops the legacy role/active columns and tokens table, so rolling back Worker code alone cannot restore the old sign-in path.

```sh
umask 077
mkdir -p work/account-cutover
npx wrangler d1 time-travel info DB --json > work/account-cutover/time-travel-before.json
npx wrangler d1 export DB --remote --output work/account-cutover/before-accounts.sql > work/account-cutover/export.log
```

Keep the export and log private: the export contains application data and the log may contain a temporary download URL. Rehearse both migration and restoration on a local copy; compare existing rows, token hashes and owner status. Refresh the bookmark immediately before release. If deployment fails after migration, prefer completing the new release. A full rollback requires coordinating the prior Worker release with a D1 Time Travel restore to the recorded bookmark, and reconciling any writes after that point. Do not restore a production database merely to test recovery.

### Cutover from Cloudflare Access

The two Access applications (**Deal Toy**, `b4fb98b3-7170-4b94-a2b8-51282ef84308`, and **Deal Toy machine endpoints**, `8522c68a-87a7-403e-941c-618b21e59d80`) still front the hostname after this release deploys, so only the approved owner reaches the new sign-in page at first.

1. Deploy, then sign in as the owner with Google. The existing member links by verified email.
2. In production, check:
   - a second Google account signs up and lands on the demo;
   - the owner promotes it in **Settings → Members** and its next request has the new access;
   - an API key works with Claude Code and stops working when revoked;
   - suspending a member ends their open session.
3. With the owner's approval, delete both Access applications (Zero Trust → Access → Applications). Then confirm an anonymous visitor sees the sign-in page, and that `/api/session` and `/mcp` return 401.

No members or keys are seeded automatically. Project sharing and OAuth for MCP clients are not implemented.

## Rollback and recovery

For normal rollback, revert the faulty change in a PR, pass checks, merge and redeploy. This rolls forward from known source and includes the corresponding native image. Worker-only version rollback may not restore the container image and never restores D1/R2 data; do not claim it is a full application rollback.

Use additive migrations. Before a destructive schema change, add a backup/restore plan and exercise restoration. Preserve the successful deployment run and release SHA for incident records. Queue jobs stuck queued/running become failed after fifteen minutes; a new explicit build retries the same immutable revision. Successful exports remain in R2 after containers stop.

## Local runtime caveat

Wrangler's Docker development runtime may use development-only container privileges such as SYS_ADMIN/FUSE. Use trusted synthetic models during local development; do not treat the local Docker setup as proof of the deployed isolation boundary. Live Cloudflare runtime acceptance must check the production configuration separately.
