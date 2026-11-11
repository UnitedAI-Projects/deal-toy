/* The Art phase: logos, lettering and illustration drawn in MantelArt. Each save from MantelArt is
   a file in the project's "art" phase; the newest version of each name is the piece. Finished
   exports can be sent to the brief's logos, and a person approves the set for production. */
import { useEffect, useMemo, useState } from "react";
import { call, type PhaseFile } from "./api";
import { engineFor } from "./EngineFrame";
import { Banner, OutputBar } from "./PhaseFrame";
import type { PhaseProps } from "./ProjectShell";
import {
  approvedBriefVersion,
  ART_KINDS,
  phaseStatus,
  withBriefLogo,
  type ArtKind,
} from "./phases";

const PREVIEW = /\.(svg|png|jpe?g|gif|webp)$/i;

export type Piece = {
  /** The artwork's name: its files' name without the extension. */
  name: string;
  /** The newest version of each of its files (source and exports), newest first. */
  files: PhaseFile[];
  versions: number;
  /** What to show: an image export. */
  preview?: PhaseFile;
  /** What to open: the editable source, else an SVG. */
  source?: PhaseFile;
};
const base = (name: string) => name.replace(/\.[^.]+$/, "");

/** Artwork grouped by name: MantelArt saves a .vectorcraft source and its exports together. */
export function pieces(files: PhaseFile[]): Piece[] {
  const newest = new Map<string, PhaseFile>();
  const count = new Map<string, number>();
  for (const f of [...files].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )) {
    if (!newest.has(f.name)) newest.set(f.name, f);
    count.set(base(f.name), (count.get(base(f.name)) ?? 0) + 1);
  }
  const groups = new Map<string, PhaseFile[]>();
  for (const f of newest.values()) {
    const key = base(f.name);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups].map(([name, fs]) => ({
    name,
    files: fs,
    versions: Math.max(
      ...fs.map((f) => files.filter((x) => x.name === f.name).length),
    ),
    preview: fs.find((f) => PREVIEW.test(f.name)),
    source:
      fs.find((f) => /\.(vectorcraft|drawcraft)$/i.test(f.name)) ??
      fs.find((f) => /\.svg$/i.test(f.name)),
  }));
}

export function ArtPhase(props: PhaseProps) {
  const { state, update, readOnly } = props;
  const [files, setFiles] = useState<PhaseFile[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    call<{ files: PhaseFile[] }>("phase_files_list", {
      projectId: props.data.project.id,
      phase: "art",
    })
      .then((r) => setFiles(r.files))
      .catch((e: Error) => setError(e.message));
  }, [props.data.project.id, props.filesVersion]);
  const list = useMemo(() => pieces(files), [files]);
  // A piece's kind is kept in the phases once it exists, so its status counts it.
  useEffect(() => {
    if (readOnly) return;
    const missing = list.filter((p) => !(p.name in state.art.kinds));
    if (missing.length)
      update((s) => ({
        ...s,
        art: {
          ...s.art,
          kinds: {
            ...s.art.kinds,
            ...Object.fromEntries(
              missing.map((p) => [p.name, guessKind(p.files[0].name)]),
            ),
          },
        },
      }));
  }, [list.map((p) => p.name).join("|")]);

  const status = phaseStatus(state, "art", props.latestRevision);
  const approved = state.art.approved;
  const latestIds = list.flatMap((p) => p.files.map((f) => f.id)).sort();
  const changedSince =
    approved &&
    JSON.stringify([...approved.files].sort()) !== JSON.stringify(latestIds);
  const logos = state.brief.files.filter((f) => f.field === "logos");
  const inBrief = new Set(logos.map((f) => f.id));

  return (
    <div className="art">
      {!state.brief.approved && (
        <Banner
          action={{ label: "Go to Brief", onClick: () => props.go("brief") }}
        >
          The brief isn't approved yet. Artwork is checked against the draft.
        </Banner>
      )}
      {status === "stale" && (
        <Banner>
          The artwork was approved on brief v{approved!.briefVersion}; brief v
          {approvedBriefVersion(state)} is now approved.
        </Banner>
      )}
      {changedSince && status !== "stale" && (
        <Banner>
          The artwork changed after it was approved. Approve the new versions to
          use them.
        </Banner>
      )}
      <div className="board-tools">
        <div className="cadbar static" role="toolbar" aria-label="Art">
          <button
            className="cadbar-button"
            disabled={readOnly}
            onClick={() => props.openEngine("mantelart", "art")}
          >
            + New artwork
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {logos.length > 0 && (
        <section className="art-brief">
          <h3>Logos in the brief</h3>
          <div className="file-row">
            {logos.map((f) => (
              <span className="file" key={f.id}>
                {f.url && f.type.startsWith("image/") ? (
                  <img src={f.url} alt="" />
                ) : (
                  <span className="file-sw">
                    {f.name.split(".").pop()?.toUpperCase()}
                  </span>
                )}
                {f.name}
                {f.url && engineFor(f.name) === "mantelart" && (
                  <button
                    className="link"
                    onClick={() =>
                      props.openEngine("mantelart", "art", {
                        name: f.name,
                        url: f.url!,
                      })
                    }
                  >
                    Redraw in MantelArt
                  </button>
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      {!list.length ? (
        <div className="concepts-empty">
          <h2>Artwork goes here</h2>
          <p className="muted">
            Draw logos, lettering and illustrations in MantelArt, or redraw a
            client's logo as clean vector artwork. Every save is kept here as a
            new version.
          </p>
        </div>
      ) : (
        <div className="board">
          {list.map((piece) => {
            const kind =
              state.art.kinds[piece.name] ?? guessKind(piece.files[0].name);
            const exportable = piece.files.find((f) =>
              /\.(svg|pdf|eps|png)$/i.test(f.name),
            );
            return (
              <div key={piece.name} className="concept art-piece">
                <span className="concept-tag">{kind}</span>
                <div className="concept-pv">
                  {piece.preview ? (
                    <img src={piece.preview.url} alt="" />
                  ) : (
                    <span className="concept-blank">
                      {piece.files[0].name.split(".").pop()?.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="concept-nm">{piece.name}</div>
                <div className="concept-meta">
                  {piece.files.map((f) => f.name.split(".").pop()).join(" · ")}{" "}
                  · {piece.versions}{" "}
                  {piece.versions === 1 ? "version" : "versions"}
                </div>
                <div className="concept-acts">
                  {piece.source && (
                    <button
                      className="link"
                      onClick={() =>
                        props.openEngine("mantelart", "art", {
                          name: piece.source!.name,
                          url: piece.source!.url,
                        })
                      }
                    >
                      Open
                    </button>
                  )}
                  {!readOnly && (
                    <select
                      aria-label={`What ${piece.name} is`}
                      value={kind}
                      onChange={(e) =>
                        update((s) => ({
                          ...s,
                          art: {
                            ...s.art,
                            kinds: {
                              ...s.art.kinds,
                              [piece.name]: e.target.value as ArtKind,
                            },
                          },
                        }))
                      }
                    >
                      {ART_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  )}
                  {!readOnly && exportable && (
                    <button
                      className="link"
                      disabled={inBrief.has(exportable.id)}
                      onClick={() =>
                        update((s) =>
                          withBriefLogo(s, {
                            id: exportable.id,
                            name: exportable.name,
                            type: exportable.media_type,
                            size: exportable.size,
                            field: "logos",
                            url: exportable.url,
                          }),
                        )
                      }
                    >
                      {inBrief.has(exportable.id)
                        ? "In the brief"
                        : "Use as a brief logo"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <OutputBar>
        <span className="output-what">Artwork</span>
        <span className="output-facts">
          <span>
            {list.length} {list.length === 1 ? "piece" : "pieces"}
          </span>
          {approved && !changedSince && status !== "stale" && (
            <span>
              <span className="phase-ok">✓</span> Approved by{" "}
              {approved.by === props.email ? "you" : approved.by || "someone"}
            </span>
          )}
        </span>
        <button
          disabled={
            readOnly ||
            !list.length ||
            (!!approved && !changedSince && status !== "stale")
          }
          onClick={() =>
            update((s) => ({
              ...s,
              art: {
                ...s.art,
                approved: {
                  files: latestIds,
                  briefVersion: approvedBriefVersion(s),
                  by: props.email,
                  at: new Date().toISOString(),
                },
              },
            }))
          }
        >
          {approved && !changedSince && status !== "stale"
            ? "Artwork approved"
            : "Approve artwork"}
        </button>
      </OutputBar>
    </div>
  );
}

function guessKind(name: string): ArtKind {
  if (/logo/i.test(name)) return "logo";
  if (/letter|text|date|word/i.test(name)) return "lettering";
  return /\.(svg|vectorcraft|eps|ai)$/i.test(name) ? "logo" : "other";
}
