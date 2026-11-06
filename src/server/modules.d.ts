declare module "*.md" {
  const content: string;
  export default content;
}
declare module "*.py" {
  const content: string;
  export default content;
}
/** Worker secret: the Google OAuth client secret (wrangler secret put GOOGLE_CLIENT_SECRET). */
/** OAUTH_PROVIDER is injected at run time by @cloudflare/workers-oauth-provider. */
interface Env {
  GOOGLE_CLIENT_SECRET: string;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}
declare namespace Cloudflare {
  interface Env {
    GOOGLE_CLIENT_SECRET: string;
    OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  }
}
