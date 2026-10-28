// Operator bootstrap and recovery: creates (or restores) a member and writes a single-use
// sign-in link, valid for 15 minutes, to a private file. Needs D1 write access through Wrangler.
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const [target, email, role, output, origin = "http://localhost:8787"] =
  process.argv.slice(2);
if (
  !["--local", "--remote"].includes(target) ||
  !email?.match(/^[a-zA-Z0-9.!#$%&*+\/?^_`{|}~-]+@[a-zA-Z0-9.-]+$/) ||
  !["owner", "member"].includes(role) ||
  !output ||
  !/^https?:\/\/[a-z0-9.:-]+$/i.test(origin)
) {
  throw new Error(
    "Usage: node ci/member.mjs --local|--remote email owner|member /private/path/link.txt [https://app-origin]",
  );
}
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const expires = new Date(Date.now() + 15 * 60_000).toISOString();
const now = new Date().toISOString();
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const address = quote(email.toLowerCase());
// An owner is made (or restored as) an active owner at the Admin level. A member is created at
// the default level if missing; an existing member's access is left unchanged.
const member =
  role === "owner"
    ? `INSERT INTO members (email,name,level_id,owner,status,created_at) VALUES (${address},'','level-admin',1,'active',${quote(now)})
       ON CONFLICT(email) DO UPDATE SET owner=1, level_id='level-admin', status='active';`
    : `INSERT INTO members (email,name,level_id,owner,status,created_at)
       SELECT ${address},'',id,0,'active',${quote(now)} FROM levels WHERE is_default=1 LIMIT 1
       ON CONFLICT(email) DO NOTHING;`;
const sql = `${member}\nINSERT INTO signin_links (hash,email,expires_at) VALUES (${quote(hash)},${address},${quote(expires)});`;
const directory = mkdtempSync(join(tmpdir(), "mantel-member-"));
try {
  const file = join(directory, "member.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", target, "--file", file],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Member provisioning failed");
  writeFileSync(resolve(output), `${origin}/link#${token}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    `Sign-in link saved to ${resolve(output)}; it works once, until ${expires}. Its value was not logged.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
