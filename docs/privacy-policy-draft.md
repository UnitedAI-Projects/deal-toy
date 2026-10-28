# Mantel privacy policy

**Draft for owner review — not published or in effect.** Prepared October 28, 2026. Set an effective date when the approved notice is published.

## Review before publishing

The account, project and session descriptions below were checked against the current implementation. The operator must confirm the following business practices; source code alone cannot establish them:

- United AI is the correct operator name, and `ivan27chen@gmail.com` should be the public privacy contact.
- The commitments below about no sale, advertising use or general-purpose model training apply to the operator's handling of Google user data.
- The operator will receive and handle access, correction and deletion requests at that address, including any required coordination with backups and service providers. The draft promises no unsupported deletion deadline.
- Any additional analytics, support tools, contractors or data uses outside this repository must be added before publication.

The proposed public text follows. Remove these review notes before publishing.

---

Mantel is an AI-assisted CAD workspace from United AI. This policy explains how we handle information when you sign in, work on designs or connect an AI client. For privacy questions or requests, contact **ivan27chen@gmail.com**.

## Information we collect and why

**Google sign-in.** We request only the `openid`, `email` and `profile` permissions. We use your Google account identifier, verified email address and name to identify your Mantel account, sign you in, associate your projects with you and enforce your access permissions. Mantel does not request access to Gmail, Google Drive, contacts or calendars. We do not receive your Google password or store a Google refresh token.

**Workspace content.** We store the projects, model source, revisions, build results, generated CAD files and documents you submit or create. We process this information to run modeling jobs, show previews, provide downloads and maintain your workspace history.

**Account and security information.** We store access levels, permissions, administrative audit records, activity timestamps, API-key labels and expiration dates, and browser information associated with sessions. Stored session tokens and API keys are hashed. Hosting and security services process network and diagnostic information, which can include IP addresses, request details and error information, to deliver, protect and troubleshoot Mantel.

## Cookies and local storage

Essential cookies maintain your sign-in session and protect the Google sign-in process. Mantel uses a 30-day session validity window; expiry, sign-out or account restrictions can end access. Your browser also stores interface preferences. Signing out ends the relevant Mantel session; it does not delete your account or workspace.

## Service providers and access to information

Google handles Google account authentication. Cloudflare hosts Mantel's application, database, file storage and CAD execution services. These providers process information needed to deliver their services under their own applicable terms and privacy policies. Authorized operators may access stored information to administer, secure and support Mantel. Data processing locations depend on the providers' infrastructure and configuration; Mantel does not currently promise storage in a particular country.

If you connect an external AI client using a Mantel API key, that client can request information and perform actions allowed by your account's current permissions. Information returned to that client is also subject to your agreement and settings with its provider. Connect only clients you trust, and revoke unused keys in Settings. Mantel does not automatically send designs to a manufacturer.

Projects explicitly marked as demos are visible to other signed-in users with demo access. Demo access limits which content and actions are available; it does not make that project's visible content private to its creator. Do not mark confidential projects as demos.

## Limits on Google user data use

We use Google user data only to provide, secure and support Mantel. We do not sell it, use it for advertising, or use it to train general-purpose AI models. Mantel's use and transfer of information received from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements.

## Retention and deletion

Mantel is currently an early-access service. Account and workspace records have no automatic deletion schedule and remain stored until the operator removes them. Expired sessions and revoked keys cease to grant access, but their database records may remain. Administrative and diagnostic records may also be retained for security and operational purposes.

To request access to, correction of or deletion of your information, email **ivan27chen@gmail.com**. We may need to verify your account ownership before acting. There is currently no self-service account or project deletion control. Backup copies may remain until their recovery retention expires, and some records may need to be retained to meet legal obligations or address security issues. We will explain any material limits affecting a deletion request.

You can revoke API keys and sign out of sessions in Settings. You can also remove Mantel's Google connection through your Google Account. Disconnecting Google, signing out or revoking a key does not delete your Mantel account or stored projects. Copies already obtained by a connected client or downloaded by you are outside Mantel's deletion controls.

## Updates

We will keep this policy available from Mantel and update its effective date when it changes. Material changes to how we use Google user data will be disclosed before the new use begins, with additional consent where required.
