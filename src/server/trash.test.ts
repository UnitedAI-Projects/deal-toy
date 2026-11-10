import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "./core";
import { dispatch, execute } from "./tools";
import { purgeExpired, TRASH_DAYS } from "./trash";
import { member } from "./test-helpers";

const source =
  "import build123d as bd\n\ndef build():\n    return bd.Box(10, 10, 10)\n";
let alice: Context;
let bob: Context;
let viewer: Context;

/** A project with a model, a revision, a finished build with one stored file, and a session. */
async function project(name: string, c = alice) {
  const p = (await execute(c, "projects_create", { name, brief: "" })) as {
    id: string;
  };
  const m = (await execute(c, "models_create", {
    projectId: p.id,
    name: "Box",
  })) as { id: string };
  const r = (await execute(c, "models_save", {
    modelId: m.id,
    expectedRevision: 0,
    source,
  })) as { id: string };
  const job = crypto.randomUUID();
  const key = `builds/${job}/model.glb`;
  await env.ARTIFACTS.put(key, "glb");
  const at = new Date().toISOString();
  const session = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO jobs (id,revision_id,status,facts,created_at,updated_at) VALUES (?,?,'succeeded','{}',?,?)",
    ).bind(job, r.id, at, at),
    env.DB.prepare(
      "INSERT INTO artifacts VALUES (?,?,'model.glb',?,'model/gltf-binary','x',3)",
    ).bind(crypto.randomUUID(), job, key),
    env.DB.prepare(
      "INSERT INTO measurements (build_id,key,value,job_id,status) VALUES (?,'k','{}',NULL,'done')",
    ).bind(job),
    // An agent session that ended, with a note delivered to it.
    env.DB.prepare(
      "INSERT INTO sessions (id,project_id,member,prompt,started_at,ended_at,last_event_at) VALUES (?,?,?,'x',?,?,?)",
    ).bind(session, p.id, c.identity.email, at, at, at),
  ]);
  const note = (await execute(c, "notes_add", {
    projectId: p.id,
    message: "Hello",
  })) as { id?: string };
  const event = await env.DB.prepare(
    "SELECT id FROM project_events WHERE project_id=? AND kind='team_note'",
  )
    .bind(p.id)
    .first<{ id: string }>();
  await env.DB.prepare("INSERT INTO note_deliveries VALUES (?,?,?)")
    .bind(event!.id, session, at)
    .run();
  void note;
  return { project: p.id, model: m.id, revision: r.id, job, key, session };
}

/** Every row anywhere that still belongs to the project. */
async function remaining(p: Awaited<ReturnType<typeof project>>) {
  const n = async (sql: string, ...binds: string[]) =>
    (await env.DB.prepare(`SELECT count(*) AS n FROM ${sql}`)
      .bind(...binds)
      .first<{ n: number }>())!.n;
  return {
    projects: await n("projects WHERE id=?", p.project),
    models: await n("models WHERE project_id=?", p.project),
    revisions: await n("revisions WHERE model_id=?", p.model),
    jobs: await n("jobs WHERE id=?", p.job),
    artifacts: await n("artifacts WHERE job_id=?", p.job),
    measurements: await n("measurements WHERE build_id=?", p.job),
    sessions: await n("sessions WHERE project_id=?", p.project),
    events: await n("project_events WHERE project_id=?", p.project),
    deliveries: await n("note_deliveries WHERE session_id=?", p.session),
    file: (await env.ARTIFACTS.get(p.key)) ? 1 : 0,
  };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  alice = await member("alice@trash.test", { owner: true, level: "Admin" });
  bob = await member("bob@trash.test", { level: "Maker" });
  viewer = await member("viewer@trash.test", { level: "Demo" });
});

describe("Deleting a project moves it to the Trash", () => {
  it("needs the project's exact name", async () => {
    const p = await project("Deal toy");
    await expect(
      execute(alice, "projects_delete", { projectId: p.project, name: "Deal" }),
    ).rejects.toMatchObject({ status: 400 });
    const list = (await execute(alice, "projects_list", {})) as {
      own: { id: string }[];
    };
    expect(list.own.map((x) => x.id)).toContain(p.project);
  });

  it("hides the project from lists and every tool, and records who did it", async () => {
    const p = await project("Hidden");
    const result = (await execute(alice, "projects_delete", {
      projectId: p.project,
      name: "Hidden",
    })) as { deleted_at: string; purge_after: string };
    expect(Date.parse(result.purge_after) - Date.parse(result.deleted_at)).toBe(
      TRASH_DAYS * 86_400_000,
    );
    const list = (await execute(alice, "projects_list", {})) as {
      own: { id: string }[];
    };
    expect(list.own.map((x) => x.id)).not.toContain(p.project);
    for (const [tool, input] of [
      ["projects_get", { projectId: p.project }],
      ["models_create", { projectId: p.project, name: "More" }],
      ["models_build", { revisionId: p.revision }],
      ["builds_get", { jobId: p.job }],
      ["steps_list", { modelId: p.model }],
      ["notes_add", { projectId: p.project, message: "Hi" }],
    ] as const)
      await expect(execute(alice, tool, input)).rejects.toMatchObject({
        status: 404,
      });
    const trash = (await execute(alice, "projects_trash", {})) as {
      projects: { id: string; name: string; deleted_by: string }[];
    };
    expect(trash.projects).toContainEqual(
      expect.objectContaining({
        id: p.project,
        name: "Hidden",
        deleted_by: "alice@trash.test",
      }),
    );
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_events WHERE target=? ORDER BY created_at",
    )
      .bind(p.project)
      .all<{ action: string }>();
    expect(audit.results.map((a) => a.action)).toContain("project.trash");
  });

  it("refuses anyone but the owner", async () => {
    const p = await project("Alice's");
    await expect(
      execute(bob, "projects_delete", {
        projectId: p.project,
        name: "Alice's",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await remaining(p)).projects).toBe(1);
  });

  it("takes a demo project away from demo viewers", async () => {
    const p = await project("Demo toy");
    await env.DB.prepare("UPDATE projects SET demo=1 WHERE id=?")
      .bind(p.project)
      .run();
    await execute(viewer, "projects_get", { projectId: p.project });
    await execute(alice, "projects_delete", {
      projectId: p.project,
      name: "Demo toy",
    });
    const list = (await execute(viewer, "projects_list", {})) as {
      demo: { id: string }[];
    };
    expect(list.demo.map((x) => x.id)).not.toContain(p.project);
    await expect(
      execute(viewer, "projects_get", { projectId: p.project }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses while a build is queued or an agent session is active", async () => {
    const p = await project("Busy");
    const at = new Date().toISOString();
    const job = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO jobs (id,revision_id,status,created_at,updated_at) VALUES (?,?,'queued',?,?)",
    )
      .bind(job, p.revision, at, at)
      .run();
    await expect(
      execute(alice, "projects_delete", { projectId: p.project, name: "Busy" }),
    ).rejects.toMatchObject({ status: 409 });
    await env.DB.prepare("UPDATE jobs SET status='succeeded' WHERE id=?")
      .bind(job)
      .run();
    const live = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO sessions (id,project_id,member,prompt,started_at,last_event_at) VALUES (?,?,?,'x',?,?)",
    )
      .bind(live, p.project, "alice@trash.test", at, at)
      .run();
    await expect(
      execute(alice, "projects_delete", { projectId: p.project, name: "Busy" }),
    ).rejects.toMatchObject({ status: 409 });
    // The agent asking may delete the project its own session is working on.
    await execute(alice, "projects_delete", {
      projectId: p.project,
      name: "Busy",
      sessionId: live,
    });
  });
});

describe("Restoring and deleting forever", () => {
  it("restores a project exactly as it was", async () => {
    const p = await project("Back again");
    await execute(alice, "projects_delete", {
      projectId: p.project,
      name: "Back again",
    });
    await execute(alice, "projects_restore", { projectId: p.project });
    const got = (await execute(alice, "projects_get", {
      projectId: p.project,
    })) as { models: unknown[]; jobs: unknown[] };
    expect(got.models).toHaveLength(1);
    expect(got.jobs).toHaveLength(1);
    expect(await remaining(p)).toMatchObject({ artifacts: 1, file: 1 });
    await expect(
      execute(alice, "projects_restore", { projectId: p.project }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("only lets a person delete forever, with the name, from the Trash", async () => {
    const p = await project("Forever");
    await expect(
      execute(alice, "projects_purge", {
        projectId: p.project,
        name: "Forever",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await execute(alice, "projects_delete", {
      projectId: p.project,
      name: "Forever",
    });
    await expect(
      dispatch(
        alice,
        "projects_purge",
        { projectId: p.project, name: "Forever" },
        "mcp",
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      execute(bob, "projects_purge", { projectId: p.project, name: "Forever" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      execute(alice, "projects_purge", { projectId: p.project, name: "Nope" }),
    ).rejects.toMatchObject({ status: 400 });
    await dispatch(
      alice,
      "projects_purge",
      { projectId: p.project, name: "Forever" },
      "http",
    );
    expect(await remaining(p)).toEqual({
      projects: 0,
      models: 0,
      revisions: 0,
      jobs: 0,
      artifacts: 0,
      measurements: 0,
      sessions: 0,
      events: 0,
      deliveries: 0,
      file: 0,
    });
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_events WHERE target=?",
    )
      .bind(p.project)
      .all<{ action: string }>();
    expect(audit.results.map((a) => a.action)).toEqual(
      expect.arrayContaining(["project.trash", "project.purge"]),
    );
  });

  it("deletes projects 30 days after they were trashed, and no sooner", async () => {
    const old = await project("Old");
    const recent = await project("Recent");
    for (const p of [old, recent])
      await execute(alice, "projects_delete", {
        projectId: p.project,
        name: p === old ? "Old" : "Recent",
      });
    const day = 86_400_000;
    await env.DB.prepare("UPDATE projects SET deleted_at=? WHERE id=?")
      .bind(
        new Date(Date.now() - (TRASH_DAYS + 1) * day).toISOString(),
        old.project,
      )
      .run();
    await env.DB.prepare("UPDATE projects SET deleted_at=? WHERE id=?")
      .bind(
        new Date(Date.now() - (TRASH_DAYS - 1) * day).toISOString(),
        recent.project,
      )
      .run();
    await purgeExpired(env);
    expect((await remaining(old)).projects).toBe(0);
    expect((await remaining(old)).file).toBe(0);
    expect(await remaining(recent)).toMatchObject({ projects: 1, file: 1 });
  });
});
