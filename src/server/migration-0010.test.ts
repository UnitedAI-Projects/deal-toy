import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("migration 0010", () => {
  it("rebuilds project_events and note_deliveries without losing rows, order or foreign keys", async () => {
    const all = env.TEST_MIGRATIONS;
    const at = all.findIndex((m) => m.name.startsWith("0010"));
    await applyD1Migrations(env.DB, all.slice(0, at));
    const note = (id: string) =>
      env.DB.prepare(
        "INSERT INTO project_events VALUES (?,'p10','s10','team_note','m10@example.test','{}','2026')",
      ).bind(id);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO members (email,name,level_id,owner,status,created_at) VALUES ('m10@example.test','m','level-maker',1,'active','2026')",
      ),
      env.DB.prepare(
        "INSERT INTO projects (id,owner,name,brief,created_at) VALUES ('p10','m10@example.test','P','','2026')",
      ),
      env.DB.prepare("INSERT INTO models VALUES ('m10','p10','M',1)"),
      env.DB.prepare(
        "INSERT INTO revisions VALUES ('r10','m10',1,'src','2026')",
      ),
      env.DB.prepare(
        "INSERT INTO sessions (id,project_id,member,prompt,started_at,last_event_at) VALUES ('s10','p10','m10@example.test','x','2026','2026')",
      ),
      // Ids out of alphabetical order, so a copy that sorted by id would be caught.
      note("zz-first"),
      note("aa-second"),
      env.DB.prepare(
        "INSERT INTO note_deliveries VALUES ('zz-first','s10','2026')",
      ),
    ]);
    await applyD1Migrations(env.DB, all);
    const { results } = await env.DB.prepare(
      "SELECT id FROM project_events WHERE project_id='p10' ORDER BY rowid",
    ).all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual(["zz-first", "aa-second"]);
    expect(
      await env.DB.prepare(
        "SELECT session_id FROM note_deliveries WHERE note_id='zz-first'",
      ).first(),
    ).toEqual({ session_id: "s10" });
    expect(
      await env.DB.prepare(
        "SELECT change_id FROM revisions WHERE id='r10'",
      ).first(),
    ).toEqual({ change_id: null });
    await env.DB.prepare(
      "INSERT INTO project_events VALUES ('c10','p10',NULL,'change','m10@example.test','{}','2026')",
    ).run();
    await expect(
      env.DB.prepare(
        "INSERT INTO note_deliveries VALUES ('missing','s10','2026')",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      env.DB.prepare(
        "INSERT INTO project_events VALUES ('x10','p10',NULL,'other','m10@example.test','{}','2026')",
      ).run(),
    ).rejects.toThrow(/CHECK/);
  });
});
