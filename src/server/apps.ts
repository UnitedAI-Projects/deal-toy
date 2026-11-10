/* Serves the phase engines' browser apps at /apps/<engine>/ to signed-in people. Each build lives
   in R2 under apps/<engine>/<tree>/, where <tree> is the Git tree of engines/<engine> it was built
   from; apps/manifest.json in R2 names the tree each engine serves. Deploys upload a build first
   and switch the manifest last, so a page never loads half of one build. */
import { authenticateBrowser } from "./auth";
import { AppError } from "./core";

export const ENGINES = [
  "manteldocs",
  "mantelpdf",
  "mantelart",
  "mantelcad",
] as const;
export type Engine = (typeof ENGINES)[number];
type Manifest = Partial<Record<Engine, { tree: string }>>;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  wasm: "application/wasm",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  jpg: "image/jpeg",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};
export const mediaType = (path: string) =>
  TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ??
  "application/octet-stream";

/** The app path under /apps/<engine>/, or null when it isn't one. Refuses traversal. */
export function appPath(
  pathname: string,
): { engine: Engine; path: string } | null {
  const m = /^\/apps\/([a-z]+)(\/.*)?$/.exec(pathname);
  if (!m || !(ENGINES as readonly string[]).includes(m[1])) return null;
  let path = decodeURIComponent((m[2] ?? "/").slice(1));
  if (path === "" || path.endsWith("/")) path += "index.html";
  if (path.split("/").some((p) => p === ".." || p === "." || p === ""))
    throw new AppError(400, "Invalid app path");
  return { engine: m[1] as Engine, path };
}

async function sha256Base64(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** The CSP for an app page: its own inline loader scripts by hash, framed only by Mantel. */
export async function appPolicy(html: string) {
  const inline = [
    ...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((m) => m[1]);
  const hashes = await Promise.all(inline.map(sha256Base64));
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.map((h) => `'sha256-${h}'`).join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export const MANIFEST_KEY = "apps/manifest.json";
let manifest: { at: number; value: Manifest } | undefined;
async function loadManifest(env: Env): Promise<Manifest> {
  if (manifest && Date.now() - manifest.at < 30_000) return manifest.value;
  const object = await env.ARTIFACTS.get(MANIFEST_KEY);
  const value = object ? ((await object.json()) as Manifest) : {};
  manifest = { at: Date.now(), value };
  return value;
}
/** Forgets the cached manifest (tests, and after a deploy writes a new one). */
export const forgetManifest = () => (manifest = undefined);

export async function serveApp(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const target = appPath(url.pathname);
  if (!target) return null;
  if (!["GET", "HEAD"].includes(request.method))
    throw new AppError(405, "Method not allowed");
  // The engines are private builds: only people signed in to Mantel load them.
  await authenticateBrowser(request, env);
  const tree = (await loadManifest(env))[target.engine]?.tree;
  if (!tree) throw new AppError(404, `${target.engine} is not deployed`);
  const object = await env.ARTIFACTS.get(
    `apps/${target.engine}/${tree}/${target.path}`,
  );
  if (!object) throw new AppError(404, "Not found");
  const type = mediaType(target.path);
  const headers = new Headers({
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (type.startsWith("text/html")) {
    const html = await object.text();
    headers.set("Content-Security-Policy", await appPolicy(html));
    headers.set("Cache-Control", "private, no-cache");
    return new Response(request.method === "HEAD" ? null : html, { headers });
  }
  // Every other file is named by its content hash or fixed per build: cache it for the session.
  headers.set(
    "Cache-Control",
    /-[0-9a-f]{16}(_bg)?\.\w+$/.test(target.path)
      ? "private, max-age=31536000, immutable"
      : "private, max-age=300",
  );
  headers.set("ETag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers,
  });
}
