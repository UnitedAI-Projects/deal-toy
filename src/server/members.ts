import { z } from "zod";
import {
  isPermission,
  memberAccess,
  PERMISSIONS,
  type MemberAccess,
  requirePermission,
  type Permission,
} from "./access";
import { AppError, shortText, type Context } from "./core";

const permission = z.custom<Permission>(isPermission, "Unknown permission");
const permissionList = z.array(permission).max(PERMISSIONS.length);
export const memberUpdate = z
  .object({
    level_id: z.string().max(80).optional(),
    allow: permissionList.optional(),
    revoke: permissionList.optional(),
    status: z.enum(["active", "suspended"]).optional(),
    owner: z.boolean().optional(),
  })
  .strict();
export const levelCreate = z
  .object({ name: shortText, permissions: permissionList })
  .strict();
export const levelUpdate = z
  .object({
    name: shortText.optional(),
    permissions: permissionList.optional(),
    is_default: z.literal(true).optional(),
  })
  .strict();
const now = () => new Date().toISOString();
const within = (granted: Iterable<Permission>, held: Set<Permission>) =>
  [...granted].every((p) => held.has(p));

function audit(
  c: Context,
  target: string,
  action: string,
  detail: unknown,
): D1PreparedStatement {
  return c.env.DB.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?,?)").bind(
    crypto.randomUUID(),
    c.identity.email,
    target,
    action,
    JSON.stringify(detail),
    now(),
  );
}
async function levelPermissions(c: Context, levelId: string) {
  const level = await c.env.DB.prepare("SELECT id FROM levels WHERE id=?")
    .bind(levelId)
    .first();
  if (!level) throw new AppError(400, "Unknown level");
  const { results } = await c.env.DB.prepare(
    "SELECT permission FROM level_permissions WHERE level_id=?",
  )
    .bind(levelId)
    .all<{ permission: string }>();
  return results.map((r) => r.permission).filter(isPermission);
}
/** Unique-name violations become a clear conflict instead of a server error. */
async function uniqueName<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      throw new AppError(409, "A level with that name already exists");
    throw error;
  }
}

/** The permissions a member would have after an update, mirroring how it is stored. */
async function resultingAccess(
  c: Context,
  target: MemberAccess,
  input: z.infer<typeof memberUpdate>,
) {
  const { results } = await c.env.DB.prepare(
    "SELECT permission,effect FROM member_permissions WHERE email=?",
  )
    .bind(target.email)
    .all<{ permission: Permission; effect: "allow" | "revoke" }>();
  const effects = new Map(results.map((r) => [r.permission, r.effect]));
  for (const effect of ["allow", "revoke"] as const) {
    const list = input[effect];
    if (!list) continue;
    for (const [p, e] of effects) if (e === effect) effects.delete(p);
    for (const p of list) effects.set(p, effect);
  }
  const levelId = input.level_id ?? target.level_id;
  const base = levelId ? await levelPermissions(c, levelId) : [];
  const allowed = [...effects].filter(([, e]) => e === "allow").map(([p]) => p);
  return new Set(
    [...base, ...allowed].filter((p) => effects.get(p) !== "revoke"),
  );
}
/** A delegate may change a level only if they could edit everyone on it directly. */
async function editableLevel(c: Context, levelId: string) {
  if (c.identity.owner) return;
  const current = await levelPermissions(c, levelId);
  if (!within(current, c.identity.permissions))
    throw new AppError(403, "That level has access you don't have");
  const { results } = await c.env.DB.prepare(
    "SELECT email FROM members WHERE level_id=?",
  )
    .bind(levelId)
    .all<{ email: string }>();
  for (const { email } of results) {
    const m = await memberAccess(c.env, email);
    if (
      !m ||
      m.owner ||
      email === c.identity.email ||
      !within(m.permissions, c.identity.permissions)
    )
      throw new AppError(
        403,
        "This level is used by people whose access you can't change",
      );
  }
}

export async function listMembers(c: Context) {
  requirePermission(c, "members.manage");
  const { results } = await c.env.DB.prepare(
    `SELECT email,name,owner,status,level_id,last_active_at,created_at,
       (SELECT json_group_array(permission) FROM (SELECT permission FROM member_permissions p WHERE p.email=m.email AND effect='allow' ORDER BY permission)) AS allow,
       (SELECT json_group_array(permission) FROM (SELECT permission FROM member_permissions p WHERE p.email=m.email AND effect='revoke' ORDER BY permission)) AS revoke
     FROM members m ORDER BY owner DESC, created_at`,
  ).all<Record<string, unknown> & { allow: string; revoke: string }>();
  return results.map((m) => ({
    ...m,
    owner: m.owner === 1,
    allow: JSON.parse(m.allow) as string[],
    revoke: JSON.parse(m.revoke) as string[],
  }));
}

/**
 * Changes one member's level, adjustments, status or ownership. A delegated administrator
 * (not an owner) can only hand out access they hold, cannot touch owners, people with more
 * access, or themselves. At least one active owner always remains.
 */
export async function updateMember(
  c: Context,
  email: string,
  input: z.infer<typeof memberUpdate>,
) {
  requirePermission(c, "members.manage");
  const target = await memberAccess(c.env, email);
  if (!target) throw new AppError(404, "Member not found");
  const held = c.identity.permissions;
  if (!c.identity.owner) {
    if (email === c.identity.email)
      throw new AppError(403, "Ask another admin to change your own access");
    if (input.owner !== undefined || target.owner)
      throw new AppError(403, "Only owners can change owners");
    if (!within(target.permissions, held))
      throw new AppError(403, "This person has access you don't have");
    // Judge the access the person would end up with, not each field on its own: clearing a
    // revoke can hand out as much as adding an allow.
    if (!within(await resultingAccess(c, target, input), held))
      throw new AppError(403, "You can only grant access you have");
  } else if (input.level_id) await levelPermissions(c, input.level_id);
  if (input.allow?.some((p) => input.revoke?.includes(p)))
    throw new AppError(400, "A permission cannot be both allowed and revoked");
  const losesOwner =
    target.owner &&
    target.status === "active" &&
    (input.owner === false || input.status === "suspended");
  if (losesOwner) {
    const others = await c.env.DB.prepare(
      "SELECT count(*) AS n FROM members WHERE owner=1 AND status='active' AND email<>?",
    )
      .bind(email)
      .first<{ n: number }>();
    if (!others?.n)
      throw new AppError(409, "At least one active owner must remain");
  }
  const db = c.env.DB;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "UPDATE members SET level_id=COALESCE(?,level_id), status=COALESCE(?,status), owner=COALESCE(?,owner) WHERE email=?",
      )
      .bind(
        input.level_id ?? null,
        input.status ?? null,
        input.owner === undefined ? null : input.owner ? 1 : 0,
        email,
      ),
  ];
  for (const effect of ["allow", "revoke"] as const) {
    const list = input[effect];
    if (!list) continue;
    statements.push(
      db
        .prepare("DELETE FROM member_permissions WHERE email=? AND effect=?")
        .bind(email, effect),
      ...list.map((p) =>
        db
          .prepare(
            "INSERT INTO member_permissions VALUES (?,?,?) ON CONFLICT(email,permission) DO UPDATE SET effect=excluded.effect",
          )
          .bind(email, p, effect),
      ),
    );
  }
  statements.push(audit(c, email, "member.update", input));
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("last_active_owner"))
      throw new AppError(409, "At least one active owner must remain");
    throw error;
  }
  return { ok: true };
}

export async function listLevels(c: Context) {
  requirePermission(c, "members.manage");
  const { results } = await c.env.DB.prepare(
    `SELECT id,name,is_default,created_at,
       (SELECT json_group_array(permission) FROM (SELECT permission FROM level_permissions lp WHERE lp.level_id=l.id ORDER BY permission)) AS permissions,
       (SELECT count(*) FROM members WHERE level_id=l.id) AS members
     FROM levels l ORDER BY created_at, (SELECT count(*) FROM level_permissions WHERE level_id=l.id), name`,
  ).all<Record<string, unknown> & { permissions: string }>();
  return results.map((l) => ({
    ...l,
    permissions: JSON.parse(l.permissions) as string[],
  }));
}

export async function createLevel(
  c: Context,
  input: z.infer<typeof levelCreate>,
) {
  requirePermission(c, "members.manage");
  if (!c.identity.owner && !within(input.permissions, c.identity.permissions))
    throw new AppError(403, "You can only grant access you have");
  const id = `level-${crypto.randomUUID()}`;
  const db = c.env.DB;
  await uniqueName(() =>
    db.batch([
      db
        .prepare(
          "INSERT INTO levels (id,name,is_default,created_at) VALUES (?,?,0,?)",
        )
        .bind(id, input.name, now()),
      ...input.permissions.map((p) =>
        db.prepare("INSERT INTO level_permissions VALUES (?,?)").bind(id, p),
      ),
      audit(c, id, "level.create", input),
    ]),
  );
  return { id };
}

export async function updateLevel(
  c: Context,
  id: string,
  input: z.infer<typeof levelUpdate>,
) {
  requirePermission(c, "members.manage");
  await editableLevel(c, id);
  if (
    !c.identity.owner &&
    !within(input.permissions ?? [], c.identity.permissions)
  )
    throw new AppError(403, "You can only grant access you have");
  const db = c.env.DB;
  const statements: D1PreparedStatement[] = [];
  if (input.name)
    statements.push(
      db.prepare("UPDATE levels SET name=? WHERE id=?").bind(input.name, id),
    );
  if (input.permissions)
    statements.push(
      db.prepare("DELETE FROM level_permissions WHERE level_id=?").bind(id),
      ...input.permissions.map((p) =>
        db.prepare("INSERT INTO level_permissions VALUES (?,?)").bind(id, p),
      ),
    );
  if (input.is_default)
    statements.push(
      db
        .prepare(
          "UPDATE levels SET is_default=CASE id WHEN ? THEN 1 ELSE 0 END",
        )
        .bind(id),
    );
  statements.push(audit(c, id, "level.update", input));
  await uniqueName(() => db.batch(statements));
  return { ok: true };
}

export async function deleteLevel(c: Context, id: string) {
  requirePermission(c, "members.manage");
  const level = await c.env.DB.prepare(
    "SELECT is_default, (SELECT count(*) FROM members WHERE level_id=?1) AS members FROM levels WHERE id=?1",
  )
    .bind(id)
    .first<{ is_default: number; members: number }>();
  if (!level) throw new AppError(404, "Level not found");
  if (level.is_default)
    throw new AppError(409, "Choose another default level first");
  if (level.members)
    throw new AppError(409, "Move everyone off this level first");
  await editableLevel(c, id);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM levels WHERE id=?").bind(id),
    audit(c, id, "level.delete", {}),
  ]);
  return { ok: true };
}

/** Marks a project the caller owns as a read-only demo, or stops showing it. */
export async function setDemo(c: Context, projectId: string, demo: boolean) {
  requirePermission(c, "settings.manage");
  const result = await c.env.DB.prepare(
    "UPDATE projects SET demo=? WHERE id=? AND owner=?",
  )
    .bind(demo ? 1 : 0, projectId, c.identity.email)
    .run();
  if (result.meta.changes !== 1) throw new AppError(404, "Project not found");
  await audit(c, projectId, "project.demo", { demo }).run();
  return { ok: true };
}

export async function account(c: Context) {
  const row = await c.env.DB.prepare(
    "SELECT members.email,members.name,members.created_at,levels.name AS level FROM members LEFT JOIN levels ON levels.id=members.level_id WHERE email=?",
  )
    .bind(c.identity.email)
    .first();
  return {
    ...row,
    owner: c.identity.owner,
    permissions: [...c.identity.permissions],
  };
}
export async function renameAccount(c: Context, name: string) {
  await c.env.DB.prepare("UPDATE members SET name=? WHERE email=?")
    .bind(name, c.identity.email)
    .run();
  return { ok: true };
}
