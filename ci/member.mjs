import { randomBytes, createHash } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const [target, email, role, output] = process.argv.slice(2);
if (
  !["--local", "--remote"].includes(target) ||
  !email?.match(/^[a-zA-Z0-9.!#$%&*+\/?^_`{|}~-]+@[a-zA-Z0-9.-]+$/) ||
  !["admin", "maker"].includes(role) ||
  !output
) {
  throw new Error(
    "Usage: node ci/member.mjs --local|--remote email admin|maker /private/path/token.txt",
  );
}
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const expires = new Date(Date.now() + 90 * 86400000).toISOString();
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const directory = mkdtempSync(join(tmpdir(), "deal-toy-member-"));
try {
  writeFileSync(resolve(output), token + "\n", { mode: 0o600, flag: "wx" });
  const sql = `INSERT INTO members VALUES (${quote(email.toLowerCase())},${quote(role)},1) ON CONFLICT(email) DO UPDATE SET role=excluded.role,active=1;\nINSERT INTO tokens VALUES (${quote(hash)},${quote(email.toLowerCase())},'personal',${quote(expires)});`;
  const file = join(directory, "member.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", target, "--file", file],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Member provisioning failed");
  console.log(
    `Token saved to ${resolve(output)}; expires ${expires}. Its value was not logged. Treat this file as a password.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
