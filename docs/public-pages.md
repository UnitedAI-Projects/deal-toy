# Public information pages

`public/info/index.html` is the Mantel homepage and `public/info/privacy/index.html` is the approved privacy policy, effective October 28, 2026. These editable HTML files are the canonical public text; Vite copies them into `dist/info/`. They need no JavaScript, external fonts, cookies or account data to render.

Production URLs:

- https://unitedai-deal-toy.ivan27chen.workers.dev/info/
- https://unitedai-deal-toy.ivan27chen.workers.dev/info/privacy/

Cloudflare Access was removed from the Mantel hostname on October 28, 2026 after owner Google sign-in was verified. The temporary `Mantel public information` Access application (`03878ed6-cc4b-4215-903a-47ca0c2441ec`) was deleted with the root gate and machine endpoint exceptions. No Access bypass is now needed. Mantel protects private APIs with its own sessions and MCP with API keys. Verify anonymous HTTP routing after any authentication change; see [deployment operations](deployment.md#cutover-from-cloudflare-access).

Google Cloud project `unitedai-mantel-prod` uses these homepage/privacy URLs. Its External OAuth app is in production. Publishing OAuth does not by itself establish brand verification; Google's account chooser currently identifies the destination as `ivan27chen.workers.dev`.

The owner approved the policy's operator/contact and Google-data use commitments before publication. Future changes must reflect actual practices. Do not introduce deletion deadlines, provider claims or legal guarantees that operations cannot meet.
