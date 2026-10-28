import { AppError, type Context, type Identity } from "./core";

/** Every permission a level or a per-person adjustment can grant. Owners have all of them. */
export const PERMISSIONS = [
  "demo.view",
  "projects.create",
  "models.edit",
  "builds.run",
  "exports.download",
  "notes.write",
  "keys.use",
  "members.manage",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const PERMISSION_LABELS: Record<Permission, string> = {
  "demo.view": "View the demo",
  "projects.create": "Create projects",
  "models.edit": "Edit models",
  "builds.run": "Run builds",
  "exports.download": "Download exports",
  "notes.write": "Leave notes",
  "keys.use": "API keys and MCP",
  "members.manage": "Manage members",
  "settings.manage": "Configure skills and tools",
};
export const isPermission = (value: unknown): value is Permission =>
  PERMISSIONS.includes(value as Permission);

/** Loads a member's current access: their level, plus individual allows, minus revokes. */
export async function loadIdentity(
  env: Pick<Env, "DB">,
  email: string,
): Promise<Identity> {
  const [member, granted] = await env.DB.batch([
    env.DB.prepare(
      "SELECT email,name,owner,status FROM members WHERE email=?",
    ).bind(email),
    env.DB.prepare(
      `SELECT permission FROM level_permissions WHERE level_id=(SELECT level_id FROM members WHERE email=?1)
       UNION SELECT permission FROM member_permissions WHERE email=?1 AND effect='allow'
       EXCEPT SELECT permission FROM member_permissions WHERE email=?1 AND effect='revoke'`,
    ).bind(email),
  ]);
  const row = member.results[0] as
    { email: string; name: string; owner: number; status: string } | undefined;
  if (!row) throw new AppError(401, "Sign in");
  if (row.status !== "active") throw new AppError(403, "Account suspended");
  const owner = row.owner === 1;
  const permissions = new Set<Permission>(
    owner
      ? PERMISSIONS
      : (granted.results as { permission: string }[])
          .map((r) => r.permission)
          .filter(isPermission),
  );
  return { email: row.email, name: row.name, owner, permissions };
}

export function requirePermission(c: Context, permission: Permission) {
  if (!c.identity.permissions.has(permission))
    throw new AppError(
      403,
      `You need the “${PERMISSION_LABELS[permission]}” permission`,
    );
}
