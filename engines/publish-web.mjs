#!/usr/bin/env node
// Uploads an engine's browser build to R2 under apps/<engine>/<tree>/, or switches the manifest
// that names which build each engine serves. Uses Wrangler's credentials (CLOUDFLARE_API_TOKEN
// in CI); --local writes to `wrangler dev`'s local R2 instead.
//
//   node engines/publish-web.mjs upload <engine> <dir> <tree> [--local]
//   node engines/publish-web.mjs has <engine> <tree> [--local]        (exit 0 when uploaded)
//   node engines/publish-web.mjs manifest <engine>=<tree>... [--local]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const BUCKET = "deal-toy-artifacts";
const ENGINES = ["manteldocs", "mantelpdf", "mantelart", "mantelcad"];
const TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  wasm: "application/wasm",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  ttf: "font/ttf",
  otf: "font/otf",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};
const args = process.argv.slice(2);
const where = args.includes("--local") ? "--local" : "--remote";
const positional = args.filter((a) => !a.startsWith("--"));
const [command, ...rest] = positional;

const wrangler = (...a) =>
  execFileSync("npx", ["wrangler", "r2", "object", ...a, where], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
const engine = (name) => {
  if (!ENGINES.includes(name)) throw new Error(`unknown engine: ${name}`);
  return name;
};
const tree = (t) => {
  if (!/^[0-9a-f]{40}$/.test(t)) throw new Error(`not a tree hash: ${t}`);
  return t;
};
function files(dir) {
  return readdirSync(dir, { recursive: true })
    .map((f) => join(dir, String(f)))
    .filter((f) => statSync(f).isFile() && !f.endsWith(".trunk-lock"));
}

if (command === "upload") {
  const [name, dir, t] = rest;
  const prefix = `apps/${engine(name)}/${tree(t)}`;
  const all = files(dir);
  // index.html last: a build is complete only once its page exists.
  all.sort((a, b) => (a.endsWith("index.html") ? 1 : 0) - (b.endsWith("index.html") ? 1 : 0));
  for (const file of all) {
    const key = `${prefix}/${relative(dir, file).split("\\").join("/")}`;
    const type = TYPES[file.split(".").pop().toLowerCase()] ?? "application/octet-stream";
    wrangler("put", `${BUCKET}/${key}`, "--file", file, "--content-type", type);
    console.log(`uploaded ${key} (${statSync(file).size} bytes)`);
  }
} else if (command === "has") {
  const [name, t] = rest;
  try {
    wrangler("get", `${BUCKET}/apps/${engine(name)}/${tree(t)}/index.html`, "--pipe");
    process.exit(0);
  } catch {
    process.exit(1);
  }
} else if (command === "manifest") {
  const manifest = {};
  for (const pair of rest) {
    const [name, t] = pair.split("=");
    manifest[engine(name)] = { tree: tree(t) };
  }
  const file = join(mkdtempSync(join(tmpdir(), "apps-")), "manifest.json");
  writeFileSync(file, JSON.stringify(manifest));
  wrangler("put", `${BUCKET}/apps/manifest.json`, "--file", file, "--content-type", "application/json");
  console.log(`manifest: ${JSON.stringify(manifest)}`);
} else {
  console.error("usage: publish-web.mjs upload|has|manifest …");
  process.exit(2);
}
