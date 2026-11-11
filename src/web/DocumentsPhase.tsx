/* Phase 4: the manufacturing package. Each document says which revision and brief version it
   was built from, turns stale when either moves on, and is approved by a person. */
import { useEffect, useMemo, useState } from "react";
import {
  call,
  download,
  type Artifact,
  type Facts,
  type PhaseFile,
} from "./api";
import { ENGINE_NAMES, engineFor } from "./EngineFrame";
import { Banner, OutputBar } from "./PhaseFrame";
import type { PhaseProps } from "./ProjectShell";
import {
  approvedBriefVersion,
  docStatus,
  DOCS,
  releaseReady,
  type DocKind,
  type PhaseState,
} from "./phases";

const GENERATED: DocKind[] = ["proof", "drawings", "files", "revisions"];

function value(s: PhaseState, key: string) {
  const fields = s.brief.approved?.fields ?? s.brief.fields;
  const f = fields.find((x) => x.key === key);
  return f && f.state !== "open" && f.state !== "na" ? f.value : "";
}

/** The latest revision of the most-revised model, and its last successful build. */
export function latestBuild(data: PhaseProps["data"]) {
  const model = [...data.models].sort((a, b) => b.revision - a.revision)[0];
  if (!model) return null;
  const revs = data.revisions
    .filter((r) => r.model_id === model.id)
    .sort((a, b) => b.number - a.number);
  for (const r of revs) {
    const job = data.jobs.find(
      (j) => j.revision_id === r.id && j.status === "succeeded",
    );
    if (job) {
      let facts: Facts | null = null;
      try {
        facts = job.facts ? (JSON.parse(job.facts) as Facts) : null;
      } catch {
        facts = null;
      }
      return {
        model,
        revision: r.number,
        artifacts: data.artifacts.filter((a) => a.job_id === job.id),
        facts,
      };
    }
  }
  return { model, revision: 0, artifacts: [] as Artifact[], facts: null };
}

function size(facts: Facts | null) {
  const b = facts?.bounds;
  if (!b || b.length < 6) return "";
  return `${(b[3] - b[0]).toFixed(0)} × ${(b[4] - b[1]).toFixed(0)} × ${(b[5] - b[2]).toFixed(0)} mm`;
}

function defaults(s: PhaseState, parts: string[]): Record<string, string> {
  const material = [value(s, "primary"), value(s, "finish")]
    .filter(Boolean)
    .join(", ");
  return {
    parts: parts.length
      ? parts
          .map((p, i) => `${i + 1}. ${p}: qty 1, ${material || "material TBD"}`)
          .join("\n")
      : "",
    assembly:
      "1. Inspect every part against the inspection checklist.\n2. \n3. \n4. Pack as the brief's packaging section describes.",
    inspection: [
      value(s, "envelope") && `Overall size within ${value(s, "envelope")}`,
      value(s, "finish") && `Finish: ${value(s, "finish")}, no visible defects`,
      value(s, "lettering") && `Lettering exactly: ${value(s, "lettering")}`,
      value(s, "logos") && `Logos match the approved artwork files`,
      value(s, "fragile") && `Fragile details: ${value(s, "fragile")}`,
      value(s, "assembly") && `Assembly look: ${value(s, "assembly")}`,
    ]
      .filter(Boolean)
      .map((x) => `[ ] ${x}`)
      .join("\n"),
  };
}

export function DocumentsPhase(props: PhaseProps) {
  const { state, update, readOnly, latestRevision, data } = props;
  const build = useMemo(() => latestBuild(data), [data]);
  const parts = build?.facts?.parts?.map((p) => p.label) ?? [];
  const bv = approvedBriefVersion(state);
  const [kind, setKind] = useState<DocKind>("proof");
  const ready = releaseReady(state, latestRevision);
  const approvedCount = DOCS.filter(
    (d) => docStatus(state.docs[d.kind], latestRevision, bv) === "approved",
  ).length;

  // Drawings and files exist once a build has produced them; the proof and history once there
  // is a revision. Drafts start from the brief and the model's parts.
  const generated = (k: DocKind) =>
    k === "drawings"
      ? !!build?.artifacts.some((a) => /\.(pdf|dxf)$/i.test(a.name))
      : k === "files"
        ? !!build?.artifacts.length
        : latestRevision > 0;
  useEffect(() => {
    if (readOnly) return;
    const fill = defaults(state, parts);
    const missing = DOCS.filter(
      (d) =>
        !state.docs[d.kind].content &&
        (GENERATED.includes(d.kind) ? generated(d.kind) : !!fill[d.kind]),
    );
    if (!missing.length) return;
    update((s) => {
      const docs = { ...s.docs };
      for (const d of missing)
        docs[d.kind] = {
          ...docs[d.kind],
          content: GENERATED.includes(d.kind) ? "generated" : fill[d.kind],
        };
      return { ...s, docs };
    });
  }, [latestRevision, parts.join("|"), build?.artifacts.length]);

  const [edited, setEdited] = useState<PhaseFile[]>([]);
  useEffect(() => {
    call<{ files: PhaseFile[] }>("phase_files_list", {
      projectId: data.project.id,
      phase: "documents",
    })
      .then((r) => setEdited(r.files))
      .catch(() => setEdited([]));
  }, [data.project.id, props.filesVersion]);
  const doc = state.docs[kind];
  const st = docStatus(doc, latestRevision, bv);
  const title = DOCS.find((d) => d.kind === kind)!.title;
  return (
    <div className="docs">
      <nav className="card doc-list" aria-label="Documents">
        <div className="muted small">
          {latestRevision
            ? `Release package for r${latestRevision}`
            : "No model revision yet"}
        </div>
        {DOCS.map((d) => {
          const s = docStatus(state.docs[d.kind], latestRevision, bv);
          const a = state.docs[d.kind].approved;
          return (
            <button
              key={d.kind}
              className={`doc-row ${d.kind === kind ? "sel" : ""}`}
              onClick={() => setKind(d.kind)}
            >
              <span>
                <span className="doc-t">{d.title}</span>
                <span className="doc-s">
                  {a
                    ? `approved on r${a.revision} · brief v${a.briefVersion}`
                    : latestRevision
                      ? `r${latestRevision} · brief v${bv || "draft"}`
                      : "waiting for a model"}
                </span>
              </span>
              <span className={`tag ${s === "empty" ? "none" : s}`}>
                {s === "empty" ? "not started" : s}
              </span>
            </button>
          );
        })}
      </nav>
      <section className="card doc-preview">
        <div className="doc-main">
          {st === "stale" && doc.approved && (
            <Banner
              action={
                readOnly
                  ? undefined
                  : {
                      label: "Review again",
                      onClick: () =>
                        update((s) => ({
                          ...s,
                          docs: {
                            ...s.docs,
                            [kind]: { ...s.docs[kind], approved: undefined },
                          },
                        })),
                    }
              }
            >
              <strong>{title} is stale.</strong> Approved on r
              {doc.approved.revision} with brief v{doc.approved.briefVersion};
              now r{latestRevision}, brief v{bv}.
            </Banner>
          )}
          <DocBody
            kind={kind}
            state={state}
            project={data.project.name}
            build={build}
            revisions={data.revisions}
            canDownload={props.canDownload}
            onOpen={(name, url) => {
              const engine = engineFor(name);
              if (engine) props.openEngine(engine, "documents", { name, url });
            }}
            readOnly={readOnly || !!doc.approved}
            content={doc.content}
            onContent={(content) =>
              update((s) => ({
                ...s,
                docs: { ...s.docs, [kind]: { ...s.docs[kind], content } },
              }))
            }
          />
          {edited.length > 0 && (
            <section className="edited">
              <h4>Edited in the apps</h4>
              <ul className="file-list">
                {edited.map((f) => (
                  <li key={f.id}>
                    <span>{f.name}</span>
                    <span className="muted small">
                      {new Date(f.created_at).toLocaleString()}
                    </span>
                    {engineFor(f.name) && (
                      <button
                        className="secondary"
                        onClick={() =>
                          props.openEngine(engineFor(f.name)!, "documents", {
                            name: f.name,
                            url: f.url,
                          })
                        }
                      >
                        Open
                      </button>
                    )}
                    <a className="link" href={f.url} download={f.name}>
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="doc-side">
          <h4>Built from</h4>
          {sources(kind, state, build, latestRevision).map(
            ([k, v, missing]) => (
              <div key={k} className={`doc-src ${missing ? "missing" : ""}`}>
                {k} <span className="muted">· {v}</span>
              </div>
            ),
          )}
          <div className="stack">
            {doc.approved ? (
              <>
                <span className="small">
                  <span className="phase-ok">✓</span> Approved by{" "}
                  {doc.approved.by === props.email ? "you" : doc.approved.by} ·{" "}
                  {new Date(doc.approved.at).toLocaleDateString()}
                </span>
                {!readOnly && (
                  <button
                    className="secondary"
                    onClick={() =>
                      update((s) => ({
                        ...s,
                        docs: {
                          ...s.docs,
                          [kind]: { ...s.docs[kind], approved: undefined },
                        },
                      }))
                    }
                  >
                    Reopen to edit
                  </button>
                )}
              </>
            ) : (
              <button
                disabled={readOnly || !latestRevision || !doc.content}
                onClick={() =>
                  update((s) => ({
                    ...s,
                    docs: {
                      ...s.docs,
                      [kind]: {
                        ...s.docs[kind],
                        approved: {
                          revision: latestRevision,
                          briefVersion: approvedBriefVersion(s),
                          by: props.email,
                          at: new Date().toISOString(),
                        },
                      },
                    },
                  }))
                }
              >
                Approve {title.toLowerCase()}
              </button>
            )}
            {kind === "proof" && (
              <button
                className="secondary"
                disabled
                title="Client share links come with the phases' server-side data"
              >
                Share for client approval
              </button>
            )}
          </div>
        </aside>
      </section>

      <OutputBar>
        <span className="output-what">
          {state.release && !ready.reasons.length
            ? "Release created"
            : "Release package"}
        </span>
        <span className="output-facts">
          <span>
            {approvedCount} of {DOCS.length} approved
          </span>
          {ready.reasons
            .filter(
              (r) =>
                r.startsWith("Stale") ||
                r.startsWith("Model") ||
                r.startsWith("No"),
            )
            .slice(0, 2)
            .map((r) => (
              <span key={r}>
                <span className="phase-dot stale" /> {r}
              </span>
            ))}
        </span>
        <button
          disabled={
            readOnly || !ready.ready || isCurrent(state, latestRevision, bv)
          }
          title={ready.reasons.join("\n") || undefined}
          onClick={() =>
            update((s) => ({
              ...s,
              release: {
                revision: latestRevision,
                briefVersion: approvedBriefVersion(s),
                by: props.email,
                at: new Date().toISOString(),
              },
            }))
          }
        >
          {isCurrent(state, latestRevision, bv)
            ? `Released r${latestRevision}`
            : "Create release"}
        </button>
      </OutputBar>
    </div>
  );
}

const isCurrent = (s: PhaseState, rev: number, bv: number) =>
  !!s.release && s.release.revision === rev && s.release.briefVersion === bv;

function sources(
  kind: DocKind,
  s: PhaseState,
  build: ReturnType<typeof latestBuild>,
  rev: number,
): [string, string, boolean][] {
  const brief = `brief v${approvedBriefVersion(s) || "draft"}`;
  const from = (label: string, key: string): [string, string, boolean] => [
    label,
    value(s, key) ? brief : "no answer in the brief",
    !value(s, key),
  ];
  switch (kind) {
    case "proof":
      return [
        [
          "Overall size",
          rev ? `r${build?.revision || rev} bounds` : "no build",
          !size(build?.facts ?? null),
        ],
        from("Materials", "primary"),
        from("Finish", "finish"),
        from("Logos", "logos"),
        from("Lettering", "lettering"),
        from("Box", "box"),
      ];
    case "drawings":
    case "files":
      return [
        [
          "Geometry",
          build?.revision ? `r${build.revision} build` : "no successful build",
          !build?.revision,
        ],
      ];
    case "parts":
      return [
        [
          "Parts",
          build?.facts?.parts?.length
            ? `r${build.revision} labelled parts`
            : "no labelled parts",
          !build?.facts?.parts?.length,
        ],
        from("Materials", "primary"),
      ];
    case "inspection":
      return [
        from("Envelope", "envelope"),
        from("Finish", "finish"),
        from("Fragile details", "fragile"),
      ];
    case "assembly":
      return [from("Assembly look", "assembly"), from("Packaging", "box")];
    case "revisions":
      return [["History", `${rev} revisions`, !rev]];
  }
}

function DocBody(props: {
  kind: DocKind;
  state: PhaseState;
  project: string;
  build: ReturnType<typeof latestBuild>;
  revisions: PhaseProps["data"]["revisions"];
  canDownload: boolean;
  onOpen: (name: string, url: string) => void;
  readOnly: boolean;
  content: string;
  onContent: (c: string) => void;
}) {
  const { state, build } = props;
  const chosen = state.concepts.find((c) => c.id === state.decision?.conceptId);
  const files = (pattern: RegExp, empty: string) => {
    const list = build?.artifacts.filter((a) => pattern.test(a.name)) ?? [];
    if (!list.length) return <p className="muted">{empty}</p>;
    return (
      <ul className="file-list">
        {list.map((a) => (
          <li key={a.id}>
            <span>{a.name}</span>
            <span className="muted small">{(a.size / 1024).toFixed(0)} KB</span>
            {engineFor(a.name) && engineFor(a.name) !== "mantelcad" && (
              <button
                className="secondary"
                disabled={!props.canDownload}
                title={
                  props.canDownload
                    ? undefined
                    : "Opening build files needs the Download exports permission"
                }
                onClick={() => props.onOpen(a.name, `/api/artifacts/${a.id}`)}
              >
                Open in {ENGINE_NAMES[engineFor(a.name)!]}
              </button>
            )}
            <button
              className="secondary"
              disabled={!props.canDownload}
              onClick={() => void download(a.id, a.name)}
            >
              Download
            </button>
          </li>
        ))}
      </ul>
    );
  };
  switch (props.kind) {
    case "proof":
      return (
        <div className="paper">
          <div className="paper-head">
            <h2>Customer proof</h2>
            <span>For approval · not for production</span>
          </div>
          <p className="paper-sub">
            {value(state, "deal") || props.project}
            {value(state, "date") ? ` · closing ${value(state, "date")}` : ""}
          </p>
          <div className="paper-art">
            {chosen?.image ? (
              <img src={chosen.image} alt="" />
            ) : (
              <span>
                {build?.revision
                  ? `Renders of r${build.revision} appear here`
                  : "No model yet"}
              </span>
            )}
          </div>
          <div className="title-block">
            <div>
              <b>Overall</b>
              {size(build?.facts ?? null) || "—"}
            </div>
            <div>
              <b>Materials</b>
              {[value(state, "primary"), value(state, "secondary")]
                .filter(Boolean)
                .join(" · ") || "—"}
            </div>
            <div>
              <b>Finish</b>
              {value(state, "finish") || "—"}
            </div>
            <div>
              <b>Revision</b>r{build?.revision || "–"} · brief v
              {approvedBriefVersion(state) || "draft"}
            </div>
          </div>
          <p className="paper-sub">
            <b>Artwork:</b> {value(state, "logos") || "—"}
            {value(state, "lettering") && <> · “{value(state, "lettering")}”</>}
          </p>
          <p className="paper-sub">
            <b>Packaging:</b> {value(state, "box") || "no answer in the brief"}
          </p>
        </div>
      );
    case "drawings":
      return (
        <>
          <h2>Part drawings</h2>
          <p className="muted">
            Generated from each build's STEP: the whole toy, then one sheet per
            part, then the lettering.
          </p>
          {files(
            /\.(pdf|dxf)$/i,
            "No drawings yet. They appear a minute or two after a successful build.",
          )}
        </>
      );
    case "files":
      return (
        <>
          <h2>Manufacturing files</h2>
          {files(/\.(step|stp|stl|glb|dxf|json)$/i, "No build files yet.")}
          {state.brief.files.filter((f) => f.field === "logos").length > 0 && (
            <>
              <h4>Artwork</h4>
              <ul className="file-list">
                {state.brief.files
                  .filter((f) => f.field === "logos")
                  .map((f) => (
                    <li key={f.id}>
                      <span>{f.name}</span>
                      <span className="muted small">from the brief</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      );
    case "revisions":
      return (
        <>
          <h2>Revision summary</h2>
          {props.revisions.length ? (
            <ol className="rev-list">
              {[...props.revisions]
                .sort((a, b) => a.number - b.number)
                .map((r) => (
                  <li key={r.id}>
                    r{r.number}{" "}
                    <span className="muted">
                      · {new Date(r.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="muted">No revisions yet.</p>
          )}
        </>
      );
    default:
      return (
        <>
          <h2>{DOCS.find((d) => d.kind === props.kind)!.title}</h2>
          <textarea
            className="doc-text"
            value={props.content}
            disabled={props.readOnly}
            placeholder="Draft it here."
            onChange={(e) => props.onContent(e.target.value)}
          />
          {props.readOnly && <p className="muted small">Reopen it to edit.</p>}
        </>
      );
  }
}
