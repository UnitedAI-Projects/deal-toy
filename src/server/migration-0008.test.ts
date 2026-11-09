import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("migration 0008", () => {
  it("rebuilds jobs and artifacts without losing rows or foreign keys", async () => {
    const all = env.TEST_MIGRATIONS;
    const at = all.findIndex((m) => m.name.startsWith("0008"));
    await applyD1Migrations(env.DB, all.slice(0, at));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO members (email,name,level_id,owner,status,created_at) VALUES ('m8@example.test','m','level-maker',1,'active','2026')",
      ),
      env.DB.prepare(
        "INSERT INTO projects (id,owner,name,brief,created_at) VALUES ('p8','m8@example.test','P','','2026')",
      ),
      env.DB.prepare("INSERT INTO models VALUES ('m8','p8','M',1)"),
      env.DB.prepare("INSERT INTO revisions VALUES ('r8','m8',1,'src','2026')"),
      env.DB.prepare(
        "INSERT INTO jobs (id,revision_id,status,error,facts,created_at,updated_at,created_by,purpose,options) VALUES ('j8','r8','succeeded',NULL,'{}','2026','2026','m8@example.test','view','{\"stopAfter\":1}')",
      ),
      env.DB.prepare(
        "INSERT INTO artifacts VALUES ('a8','j8','model.glb','builds/j8/model.glb','model/gltf-binary','x',3)",
      ),
    ]);
    await applyD1Migrations(env.DB, all);
    expect(
      await env.DB.prepare(
        "SELECT purpose,options,created_by FROM jobs WHERE id='j8'",
      ).first(),
    ).toEqual({
      purpose: "view",
      options: '{"stopAfter":1}',
      created_by: "m8@example.test",
    });
    expect(
      await env.DB.prepare(
        "SELECT job_id FROM artifacts WHERE id='a8'",
      ).first(),
    ).toEqual({ job_id: "j8" });
    await env.DB.prepare(
      "INSERT INTO jobs (id,revision_id,status,created_at,updated_at,purpose) VALUES ('j9','r8','queued','2026','2026','measure')",
    ).run();
    await expect(
      env.DB.prepare(
        "INSERT INTO artifacts VALUES ('a9','missing','x','k9','m','x',1)",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      env.DB.prepare(
        "INSERT INTO jobs (id,revision_id,status,created_at,updated_at,purpose) VALUES ('j10','r8','queued','2026','2026','other')",
      ).run(),
    ).rejects.toThrow(/CHECK/);
  });
});
