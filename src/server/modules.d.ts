declare module "*.md" {
  const content: string;
  export default content;
}
declare namespace Cloudflare {
  interface Env {
    /** Worker secret: the Google OAuth client secret. */
    GOOGLE_CLIENT_SECRET: string;
  }
}
