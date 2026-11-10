# Built-in phase agent

The phase panel uses a Workers AI binding with @cf/meta/llama-3.3-70b-instruct-fp8-fast. Cloudflare documents [the model and function calling](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) and [traditional tool results](https://developers.cloudflare.com/workers-ai/features/function-calling/traditional/). No provider key enters browser code.

## Current behavior

- Conversations are private to an owned project and phase, persisted in D1. Opening another phase cannot show a late answer from the previous one.
- Guidance uses current server phase state. Brief updates save up to ten requested answers atomically, preserve other fields and approval snapshots, record the source as agent, and open a new brief version after approval.
- General phase saves use the existing typed tool, with optimistic concurrency and its people-only approval check. Unknown tools and model-supplied project/session IDs are rejected.
- Each completed action has a server receipt. A provider error after a saved action does not undo or hide that action.
- Native canvas editing, file-content reading, CAD builds, client sharing and manufacturing integrations are not available through this agent.

## Bounds

Each request has at most two model calls, three tools, 18,000 UTF-8 input bytes per model call (including tool schemas), and 2,048 output tokens per model call. An inference call times out after 60 seconds; a timed-out result is ignored and cannot trigger tools. Large project context is refused explicitly. History supplies only the latest four completed turns, with bounded message excerpts; it is not indefinite model memory.

AGENT_DAILY_LIMIT=20 and AGENT_GLOBAL_DAILY_LIMIT=100 cap admitted requests per rolling 24 hours. Failed requests consume quota. Admission uses an atomic conditional insert, and a content-free usage ledger survives project deletion to prevent quota resets. Limits are configurable up to 100/member and 1,000/global; 0 disables new requests. No currency-denominated budget has been specified.

## Local verification

Run npm run db:local, npm run build, npm run dev, and npm test. Sign in through the documented local account setup, create a synthetic project, and ask “Set the Deal answer to Harbor acquires Northline, marked answered.” Check that the answer changes live, other fields and approvals remain intact, a successful action receipt appears, and history survives reload.

The automated agent tests use fake inference and exercise ownership, permission revocation, disabled tools, arbitrary actions, project/session injection, approval changes, stale versions, concurrent quota admission, persistent receipts after failure, nullable provider responses, first-draft initialization and request validation. Live Wrangler calls use real Cloudflare inference and account usage.

Acceptance observed on 2026-11-10: real Workers AI guidance and single-field and multiple-field updates from the MacBook through the mini's forwarded development server. Production acceptance remains separate.

[Editable example and desktop/mobile evidence](../examples/agent/README.md).
