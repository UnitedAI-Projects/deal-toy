declare module "*.md" {
  const content: string;
  export default content;
}
/** Worker secret: the Google OAuth client secret (wrangler secret put GOOGLE_CLIENT_SECRET). */
interface Env {
  GOOGLE_CLIENT_SECRET: string;
}
declare namespace Cloudflare {
  interface Env {
    GOOGLE_CLIENT_SECRET: string;
  }
}
