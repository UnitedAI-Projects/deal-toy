import { z } from "zod";
import { appName, grantUser, listGrants, recordApp } from "./oauth";
import { AppError, boundedText, type Context } from "./core";
import {
  account,
  createLevel,
  deleteLevel,
  levelCreate,
  levelUpdate,
  listLevels,
  listMembers,
  memberUpdate,
  renameAccount,
  setDemo,
  updateLevel,
  updateMember,
} from "./members";

const accountInput = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
const demoInput = z.object({ demo: z.boolean() }).strict();

async function json(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new AppError(415, "Use application/json");
  try {
    return JSON.parse(await boundedText(request, 20_000)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Invalid JSON");
  }
}

/**
 * The member's connected apps, newest first. A sign-in the app has not finished yet (approved, but
 * its code never swapped for passes) has no expiry and is not listed.
 */
async function connectedApps(c: Context) {
  const grants = await listGrants(
    c.env.OAUTH_PROVIDER,
    await grantUser(c.identity.email),
  );
  return grants
    .filter((grant) => grant.expiresAt !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Handles /api/settings/* for the signed-in member, or returns null for other paths. */
export async function settingsRoute(
  request: Request,
  url: URL,
  c: Context,
): Promise<Response | null> {
  const path = url.pathname.slice("/api/settings".length);
  const method = request.method;
  // Any member may see and disconnect their own connected apps, whatever their permissions.
  if (path === "/connected-apps" && method === "GET")
    return Response.json(
      (await connectedApps(c)).map((grant) => ({
        id: grant.id,
        name: appName(grant),
        connected_at: new Date(grant.createdAt * 1000).toISOString(),
      })),
    );
  const appMatch = /^\/connected-apps\/([^/]*)$/.exec(path);
  if (appMatch && method === "DELETE") {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(appMatch[1]))
      throw new AppError(400, "Invalid app id");
    const grant = (await connectedApps(c)).find((g) => g.id === appMatch[1]);
    if (!grant) throw new AppError(404, "App not found");
    // Cut the app off completely, including any sign-in it has not finished yet.
    const all = await listGrants(c.env.OAUTH_PROVIDER, grant.userId);
    await Promise.all(
      all
        .filter((g) => g.clientId === grant.clientId)
        .map((g) => c.env.OAUTH_PROVIDER.revokeGrant(g.id, grant.userId)),
    );
    await recordApp(c.env, c.identity.email, "app.disconnect", {
      app: appName(grant),
      grant: grant.id,
    });
    return Response.json({ ok: true });
  }
  if (path === "/account" && method === "GET")
    return Response.json(await account(c));
  if (path === "/account" && method === "PATCH")
    return Response.json(
      await renameAccount(c, accountInput.parse(await json(request)).name),
    );
  if (path === "/members" && method === "GET")
    return Response.json(await listMembers(c));
  const memberMatch = /^\/members\/([^/]{3,320})$/.exec(path);
  if (memberMatch && method === "PATCH")
    return Response.json(
      await updateMember(
        c,
        decodeURIComponent(memberMatch[1]).toLowerCase(),
        memberUpdate.parse(await json(request)),
      ),
    );
  if (path === "/levels" && method === "GET")
    return Response.json(await listLevels(c));
  if (path === "/levels" && method === "POST")
    return Response.json(
      await createLevel(c, levelCreate.parse(await json(request))),
    );
  const levelMatch = /^\/levels\/(level-[a-z0-9-]{1,40})$/.exec(path);
  if (levelMatch && method === "PATCH")
    return Response.json(
      await updateLevel(
        c,
        levelMatch[1],
        levelUpdate.parse(await json(request)),
      ),
    );
  if (levelMatch && method === "DELETE")
    return Response.json(await deleteLevel(c, levelMatch[1]));
  const demoMatch = /^\/projects\/([0-9a-f-]{36})\/demo$/.exec(path);
  if (demoMatch && method === "PATCH")
    return Response.json(
      await setDemo(c, demoMatch[1], demoInput.parse(await json(request)).demo),
    );
  return null;
}
