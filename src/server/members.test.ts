import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { execute } from "./tools";
import { cookieFor, member } from "./test-helpers";

const origin = "https://example.test";
let ownerCookie: string;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await member("owner@m.test", { owner: true, level: "Admin" });
  ownerCookie = await cookieFor("owner@m.test");
});
function call(cookie: string, path: string, method = "GET", body?: unknown) {
  return exports.default.fetch(`${origin}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const patchMember = (cookie: string, email: string, body: unknown) =>
  call(
    cookie,
    `/api/settings/members/${encodeURIComponent(email)}`,
    "PATCH",
    body,
  );
const permissionsOf = async (cookie: string) =>
  (
    (await (await call(cookie, "/api/session")).json()) as {
      permissions: string[];
    }
  ).permissions;

describe("Members", () => {
  it("are promoted by the owner, effective on the next request", async () => {
    await member("newbie@m.test", { level: "Demo" });
    const cookie = await cookieFor("newbie@m.test");
    const create = () =>
      call(cookie, "/api/tools/projects_create", "POST", { name: "Mine" });
    expect((await create()).status).toBe(403);
    expect(
      (
        await patchMember(ownerCookie, "newbie@m.test", {
          level_id: "level-maker",
        })
      ).status,
    ).toBe(200);
    expect((await create()).status).toBe(200);
  });
  it("get per-person allows and revokes on top of their level", async () => {
    await member("tuned@m.test", { level: "Demo" });
    const cookie = await cookieFor("tuned@m.test");
    await patchMember(ownerCookie, "tuned@m.test", {
      allow: ["exports.download", "notes.write"],
      revoke: ["demo.view"],
    });
    expect((await permissionsOf(cookie)).sort()).toEqual([
      "exports.download",
      "notes.write",
    ]);
    const listed = (await (
      await call(ownerCookie, "/api/settings/members")
    ).json()) as {
      email: string;
      allow: string[];
      revoke: string[];
    }[];
    expect(listed.find((m) => m.email === "tuned@m.test")).toMatchObject({
      allow: ["exports.download", "notes.write"],
      revoke: ["demo.view"],
    });
  });
  it("can be listed only with members.manage", async () => {
    await member("plain@m.test", { level: "Maker" });
    expect(
      (await call(await cookieFor("plain@m.test"), "/api/settings/members"))
        .status,
    ).toBe(403);
  });
  it("respect delegated admin limits", async () => {
    await member("delegate@m.test", {
      level: "Maker",
      allow: ["members.manage"],
    });
    await member("admin@m.test", { level: "Admin" });
    await member("target@m.test", { level: "Demo" });
    const cookie = await cookieFor("delegate@m.test");
    const refused: [string, string, unknown][] = [
      ["own row", "delegate@m.test", { level_id: "level-demo" }],
      ["more access", "admin@m.test", { level_id: "level-demo" }],
      ["allow beyond own", "target@m.test", { allow: ["settings.manage"] }],
      ["level beyond own", "target@m.test", { level_id: "level-admin" }],
      ["ownership", "target@m.test", { owner: true }],
      ["an owner", "owner@m.test", { status: "suspended" }],
    ];
    for (const [name, email, body] of refused)
      expect((await patchMember(cookie, email, body)).status, name).toBe(403);
    const editLevel = await call(
      cookie,
      "/api/settings/levels/level-admin",
      "PATCH",
      {
        name: "Boss",
      },
    );
    expect(editLevel.status).toBe(403);
    expect(
      (await patchMember(cookie, "target@m.test", { level_id: "level-maker" }))
        .status,
    ).toBe(200);
  });
  it("always keep one active owner", async () => {
    expect(
      (await patchMember(ownerCookie, "owner@m.test", { owner: false })).status,
    ).toBe(409);
    expect(
      (await patchMember(ownerCookie, "owner@m.test", { status: "suspended" }))
        .status,
    ).toBe(409);
    await member("second@m.test", { level: "Admin" });
    expect(
      (await patchMember(ownerCookie, "second@m.test", { owner: true })).status,
    ).toBe(200);
    expect(
      (await patchMember(ownerCookie, "second@m.test", { owner: false }))
        .status,
    ).toBe(200);
  });
  it("are audited on every change", async () => {
    await member("audited@m.test", { level: "Demo" });
    await patchMember(ownerCookie, "audited@m.test", { status: "suspended" });
    const row = await env.DB.prepare(
      "SELECT actor,target,action,detail FROM audit_events WHERE target='audited@m.test'",
    ).first<{ actor: string; action: string; detail: string }>();
    expect(row).toMatchObject({
      actor: "owner@m.test",
      action: "member.update",
    });
    expect(JSON.parse(row!.detail)).toEqual({ status: "suspended" });
  });
});

describe("Access levels", () => {
  it("can be created, edited, made default and deleted when unused", async () => {
    const created = await call(ownerCookie, "/api/settings/levels", "POST", {
      name: "Reviewer",
      permissions: ["demo.view", "exports.download"],
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    expect(
      (
        await call(ownerCookie, "/api/settings/levels", "POST", {
          name: "Reviewer",
          permissions: [],
        })
      ).status,
    ).toBe(409);
    await call(ownerCookie, `/api/settings/levels/${id}`, "PATCH", {
      name: "Reviewers",
      permissions: ["demo.view"],
      is_default: true,
    });
    const levels = (await (
      await call(ownerCookie, "/api/settings/levels")
    ).json()) as {
      id: string;
      name: string;
      is_default: number;
      permissions: string[];
      members: number;
    }[];
    expect(levels.find((l) => l.id === id)).toMatchObject({
      name: "Reviewers",
      is_default: 1,
      permissions: ["demo.view"],
    });
    expect(levels.filter((l) => l.is_default === 1)).toHaveLength(1);
    expect(
      (await call(ownerCookie, `/api/settings/levels/${id}`, "DELETE")).status,
    ).toBe(409);
    await call(ownerCookie, "/api/settings/levels/level-demo", "PATCH", {
      is_default: true,
    });
    expect(
      (await call(ownerCookie, "/api/settings/levels/level-maker", "DELETE"))
        .status,
    ).toBe(409);
    expect(
      (await call(ownerCookie, `/api/settings/levels/${id}`, "DELETE")).status,
    ).toBe(200);
  });
});

describe("Demo flag and account", () => {
  it("needs settings.manage and the project's ownership", async () => {
    const maker = await member("demo-maker@m.test", { level: "Maker" });
    const p = (await execute(maker, "projects_create", { name: "M" })) as {
      id: string;
    };
    const path = `/api/settings/projects/${p.id}/demo`;
    expect(
      (
        await call(await cookieFor("demo-maker@m.test"), path, "PATCH", {
          demo: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(ownerCookie, path, "PATCH", { demo: true })).status,
    ).toBe(404);
    const owner = await member("owner@m.test", { owner: true, level: "Admin" });
    const mine = (await execute(owner, "projects_create", {
      name: "Demo",
    })) as { id: string };
    expect(
      (
        await call(
          ownerCookie,
          `/api/settings/projects/${mine.id}/demo`,
          "PATCH",
          { demo: true },
        )
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare("SELECT demo FROM projects WHERE id=?")
        .bind(mine.id)
        .first(),
    ).toEqual({ demo: 1 });
  });
  it("lets members rename themselves", async () => {
    await member("named@m.test", { level: "Demo" });
    const cookie = await cookieFor("named@m.test");
    expect(
      (
        await call(cookie, "/api/settings/account", "PATCH", {
          name: "Ada Lovelace",
        })
      ).status,
    ).toBe(200);
    expect(
      await (await call(cookie, "/api/settings/account")).json(),
    ).toMatchObject({
      email: "named@m.test",
      name: "Ada Lovelace",
      level: "Demo",
    });
  });
});
