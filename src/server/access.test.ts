import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { loadIdentity, PERMISSIONS } from "./access";
import { hash } from "./core";
import { member } from "./test-helpers";

const before = env.TEST_MIGRATIONS.filter((m) => !m.name.startsWith("0003"));
beforeAll(async () => {
  // Members and a token as they exist in production before the accounts migration.
  await applyD1Migrations(env.DB, before);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO members VALUES ('a@x.test','admin',1),('m@x.test','maker',1),('s@x.test','maker',0)",
    ),
    env.DB.prepare("INSERT INTO tokens VALUES (?,?,?,?)").bind(
      await hash("legacy-token-with-more-than-thirty-two-chars"),
      "a@x.test",
      "laptop",
      "2099-01-01T00:00:00.000Z",
    ),
  ]);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("Accounts migration", () => {
  it("migrates admins to owners and makers to the Maker level", async () => {
    const rows = (
      await env.DB.prepare(
        "SELECT email,owner,level_id,status FROM members ORDER BY email",
      ).all()
    ).results;
    expect(rows).toEqual([
      {
        email: "a@x.test",
        owner: 1,
        level_id: "level-admin",
        status: "active",
      },
      {
        email: "m@x.test",
        owner: 0,
        level_id: "level-maker",
        status: "active",
      },
      {
        email: "s@x.test",
        owner: 0,
        level_id: "level-maker",
        status: "suspended",
      },
    ]);
    const keys = (
      await env.DB.prepare("SELECT email,name,prefix,hash FROM api_keys").all()
    ).results;
    expect(keys).toEqual([
      {
        email: "a@x.test",
        name: "laptop",
        prefix: "legacy",
        hash: await hash("legacy-token-with-more-than-thirty-two-chars"),
      },
    ]);
    const tokens = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name='tokens'",
    ).first();
    expect(tokens).toBeNull();
  });
});

describe("Effective permissions", () => {
  it("are the level plus allows minus revokes", async () => {
    const c = await member("maker@x.test", {
      level: "Maker",
      allow: ["members.manage"],
      revoke: ["builds.run"],
    });
    expect(c.identity.permissions.has("members.manage")).toBe(true);
    expect(c.identity.permissions.has("builds.run")).toBe(false);
    expect(c.identity.permissions.has("models.edit")).toBe(true);
    expect(c.identity.permissions.has("settings.manage")).toBe(false);
  });
  it("seed Demo with only demo.view", async () => {
    const c = await member("demo@x.test", { level: "Demo" });
    expect([...c.identity.permissions]).toEqual(["demo.view"]);
  });
  it("give owners every permission regardless of level or revokes", async () => {
    const c = await member("owner@x.test", {
      owner: true,
      level: "Demo",
      revoke: ["keys.use"],
    });
    expect(c.identity.owner).toBe(true);
    expect([...c.identity.permissions].sort()).toEqual([...PERMISSIONS].sort());
  });
  it("refuse suspended members", async () => {
    await member("gone@x.test", { level: "Maker", status: "suspended" });
    await expect(loadIdentity(env, "gone@x.test")).rejects.toMatchObject({
      status: 403,
    });
    await expect(loadIdentity(env, "nobody@x.test")).rejects.toMatchObject({
      status: 401,
    });
  });
});
