# Public information pages

`public/info/index.html` is the Mantel homepage and `public/info/privacy/index.html` is the approved privacy policy, effective October 28, 2026. These editable HTML files are the canonical public text; Vite copies them into `dist/info/`. They need no JavaScript, external fonts, cookies or account data to render.

Production URLs:

- https://unitedai-deal-toy.ivan27chen.workers.dev/info/
- https://unitedai-deal-toy.ivan27chen.workers.dev/info/privacy/

Cloudflare Access must exempt only this information-page prefix using a dedicated `Mantel public information` application for `unitedai-deal-toy.ivan27chen.workers.dev/info/*` and the reusable `Mantel - public homepage and privacy` Bypass/Everyone policy. The application ID is `03878ed6-cc4b-4215-903a-47ca0c2441ec`; the reusable policy ID is `399195f7-cce8-4300-a566-e3f5b3b13d4e`. The workspace, `/api/`, and neighboring `/infox` must retain their existing protection. The machine endpoint exceptions are separate. Verify anonymous HTTP routing after any Access change.

The pages support Google OAuth production branding before the accounts release deploys. Google Cloud project `unitedai-mantel-prod` should use these homepage/privacy URLs. Publishing OAuth does not by itself establish brand verification.

The owner approved the policy's operator/contact and Google-data use commitments before publication. Future changes must reflect actual practices. Do not introduce deletion deadlines, provider claims or legal guarantees that operations cannot meet.
