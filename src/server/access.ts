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

export type MemberAccess = {
  email: string;
  name: string;
  owner: boolean;
  status: "active" | "suspended";
  level_id: string | null;
  permissions: Set<Permission>;
};
/** A member's current access whatever their status: level, plus allows, minus revokes. */
export async function memberAccess(
  env: Pick<Env, "DB">,
  email: string,
): Promise<MemberAccess | null> {
  const [member, granted] = await env.DB.batch([
    env.DB.prepare(
      "SELECT email,name,owner,status,level_id FROM members WHERE email=?",
    ).bind(email),
    env.DB.prepare(
      `SELECT permission FROM level_permissions WHERE level_id=(SELECT level_id FROM members WHERE email=?1)
       UNION SELECT permission FROM member_permissions WHERE email=?1 AND effect='allow'
       EXCEPT SELECT permission FROM member_permissions WHERE email=?1 AND effect='revoke'`,
    ).bind(email),
  ]);
  const row = member.results[0] as
    | (Omit<MemberAccess, "owner" | "permissions"> & { owner: number })
    | undefined;
  if (!row) return null;
  const owner = row.owner === 1;
  return {
    ...row,
    owner,
    permissions: new Set<Permission>(
      owner
        ? PERMISSIONS
        : (granted.results as { permission: string }[])
            .map((r) => r.permission)
            .filter(isPermission),
    ),
  };
}

/** Loads an active member's identity; unknown members must sign in, suspended ones are refused. */
export async function loadIdentity(
  env: Pick<Env, "DB">,
  email: string,
): Promise<Identity> {
  const member = await memberAccess(env, email);
  if (!member) throw new AppError(401, "Sign in");
  if (member.status !== "active") throw new AppError(403, "Account suspended");
  return {
    email: member.email,
    name: member.name,
    owner: member.owner,
    permissions: member.permissions,
  };
}

export function requirePermission(c: Context, permission: Permission) {
  if (!c.identity.permissions.has(permission))
    throw new AppError(
      403,
      `You need the “${PERMISSION_LABELS[permission]}” permission`,
    );
}
