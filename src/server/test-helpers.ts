import { env } from "cloudflare:workers";
import { loadIdentity, type Permission } from "./access";
import { createSession } from "./auth";
import { hash, type Context } from "./core";

const LEVEL_IDS = {
  Demo: "level-demo",
  Maker: "level-maker",
  Admin: "level-admin",
} as const;

/** Creates (or resets) a member for a test and returns a context with their current access. */
export async function member(
  email: string,
  options: {
    owner?: boolean;
    level?: keyof typeof LEVEL_IDS;
    allow?: Permission[];
    revoke?: Permission[];
    status?: "active" | "suspended";
    name?: string;
  } = {},
): Promise<Context> {
  const level = LEVEL_IDS[options.level ?? "Maker"];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (email,name,level_id,owner,status,created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET name=excluded.name, level_id=excluded.level_id,
         owner=excluded.owner, status=excluded.status`,
    ).bind(
      email,
      options.name ?? email.split("@")[0],
      level,
      options.owner ? 1 : 0,
      options.status ?? "active",
      new Date().toISOString(),
    ),
    env.DB.prepare("DELETE FROM member_permissions WHERE email=?").bind(email),
    ...(options.allow ?? []).map((p) =>
      env.DB.prepare(
        "INSERT INTO member_permissions VALUES (?,?,'allow')",
      ).bind(email, p),
    ),
    ...(options.revoke ?? []).map((p) =>
      env.DB.prepare(
        "INSERT INTO member_permissions VALUES (?,?,'revoke')",
      ).bind(email, p),
    ),
  ]);
  if (options.status === "suspended")
    return {
      env,
      identity: { email, name: "", owner: false, permissions: new Set() },
    };
  return { env, identity: await loadIdentity(env, email) };
}

/** A browser session cookie (name=value) for a member. */
export async function cookieFor(email: string) {
  return (await createSession(env, email, "test")).split(";")[0];
}

/** An API key for a member, stored the way Settings stores one. */
export async function apiKey(email: string) {
  const value = `mtl_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  await env.DB.prepare(
    "INSERT INTO api_keys (id,email,name,prefix,hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      email,
      "test",
      value.slice(0, 8),
      await hash(value),
      new Date().toISOString(),
      "2099-01-01T00:00:00.000Z",
    )
    .run();
  return value;
}
