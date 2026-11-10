/* Opens a phase engine (served at /apps/<engine>/) over the project, with a file loaded, and keeps
   every save as a new phase file. Engines with the Craft host bridge (MantelDocs, MantelPDF) talk
   over postMessage (<app>:ready/open/save/saved/dirty/failed); MantelArt is driven through its
   page API (window.vectorcraft); MantelCAD has no file bridge yet and opens on its own. */
import { useEffect, useRef, useState } from "react";
import { request, uploadPhaseFile, type PhaseFile } from "./api";

export type EngineId = "manteldocs" | "mantelpdf" | "mantelart" | "mantelcad";
export const ENGINE_NAMES: Record<EngineId, string> = {
  manteldocs: "MantelDocs",
  mantelpdf: "MantelPDF",
  mantelart: "MantelArt",
  mantelcad: "MantelCAD",
};
const BRIDGED: EngineId[] = ["manteldocs", "mantelpdf"];

/** Which engine opens a file, by its name; null when none does. */
export function engineFor(name: string): EngineId | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "mantelpdf";
  if (ext === "dxf" || ext === "dwg") return "manteldocs";
  if (ext === "svg" || ext === "vectorcraft" || ext === "drawcraft")
    return "mantelart";
  if (ext === "step" || ext === "stp" || ext === "sc") return "mantelcad";
  return null;
}

type Saved = { file: PhaseFile; at: string };

export function EngineFrame(props: {
  engine: EngineId;
  projectId: string;
  /** The phase saves are filed under. */
  phase: string;
  /** The file to open: a phase file or a build artifact URL. */
  file?: { name: string; url: string };
  readOnly: boolean;
  onSaved: (file: PhaseFile) => void;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState("Starting…");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [error, setError] = useState("");
  const name = ENGINE_NAMES[props.engine];
  const bridged = BRIDGED.includes(props.engine);
  const src = `/apps/${props.engine}/${bridged ? "?host=parent" : ""}`;
  const [deployed, setDeployed] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`/apps/${props.engine}/`, {
      method: "HEAD",
      credentials: "same-origin",
    })
      .then((r) => setDeployed(r.ok))
      .catch(() => setDeployed(false));
  }, [props.engine]);

  async function keep(fileName: string, bytes: ArrayBuffer | Uint8Array) {
    if (props.readOnly) throw new Error("This project is view-only");
    const body = new Blob([bytes as BlobPart]);
    const file = await uploadPhaseFile(
      props.projectId,
      props.phase,
      fileName,
      body,
    );
    setSaved((s) => [{ file, at: new Date().toLocaleTimeString() }, ...s]);
    props.onSaved(file);
    return file;
  }
  async function bytesOf(url: string) {
    return await (await request(url)).arrayBuffer();
  }

  // Bridged engines: the Craft host contract over postMessage.
  useEffect(() => {
    if (!bridged) return;
    let app = "";
    const post = (
      kind: string,
      fields: Record<string, unknown>,
      transfer?: Transferable[],
    ) =>
      frame.current?.contentWindow?.postMessage(
        { type: `${app}:${kind}`, ...fields },
        location.origin,
        transfer,
      );
    async function on(e: MessageEvent) {
      if (
        e.origin !== location.origin ||
        e.source !== frame.current?.contentWindow
      )
        return;
      const data = e.data as { type?: unknown } & Record<string, unknown>;
      if (typeof data?.type !== "string") return;
      const [who, kind] = data.type.split(":", 2);
      if (!kind) return;
      if (kind === "ready") {
        app = who;
        post("host", { version: "1" });
        if (props.file) {
          setStatus(`Opening ${props.file.name}…`);
          try {
            const bytes = await bytesOf(props.file.url);
            post("open", { name: props.file.name, bytes }, [bytes]);
            setStatus(props.file.name);
          } catch (err) {
            setError(
              `Couldn't open ${props.file.name}: ${(err as Error).message}`,
            );
          }
        } else setStatus("Ready");
        return;
      }
      if (who !== app) return;
      if (kind === "save") {
        const fileName =
          typeof data.name === "string" && data.name ? data.name : "document";
        const bytes =
          data.bytes instanceof ArrayBuffer || data.bytes instanceof Uint8Array
            ? data.bytes
            : null;
        if (!bytes) return;
        try {
          await keep(fileName, bytes);
          if (typeof data.id === "string") post("saved", { id: data.id });
          setStatus(`Saved ${fileName}`);
        } catch (err) {
          setError(`Couldn't keep ${fileName}: ${(err as Error).message}`);
        }
      } else if (kind === "dirty") setDirty(data.dirty === true);
      else if (kind === "failed")
        setError(
          `${name}: ${typeof data.error === "string" ? data.error : "failed"}`,
        );
      else if (kind === "handoff")
        setStatus("Handing a file to another app isn't connected yet");
    }
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [bridged, props.file?.url]);

  // MantelArt: its page API. Saves are kept in the page and collected here.
  useEffect(() => {
    if (props.engine !== "mantelart") return;
    type Api = {
      openFile: (name: string, bytes: Uint8Array) => boolean;
      captureDownloads: (on: boolean) => void;
      files: () => { path: string; size: number }[];
      readFile: (path: string) => Uint8Array;
    };
    let stopped = false;
    const seen = new Map<string, string>();
    const digest = async (b: Uint8Array) =>
      [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", b as BufferSource),
        ),
      ]
        .slice(0, 8)
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    void (async () => {
      let api: Api | undefined;
      for (let i = 0; i < 240 && !stopped && !api; i++) {
        api = (frame.current?.contentWindow as unknown as { vectorcraft?: Api })
          ?.vectorcraft;
        if (!api) await new Promise((r) => setTimeout(r, 250));
      }
      if (!api || stopped) return;
      api.captureDownloads(!props.readOnly);
      if (props.file) {
        try {
          const bytes = new Uint8Array(await bytesOf(props.file.url));
          if (!api.openFile(props.file.name, bytes))
            setError(`MantelArt wasn't ready to open ${props.file.name}`);
          setStatus(props.file.name);
        } catch (err) {
          setError(
            `Couldn't open ${props.file.name}: ${(err as Error).message}`,
          );
        }
      } else setStatus("Ready");
      while (!stopped) {
        await new Promise((r) => setTimeout(r, 1500));
        for (const f of api.files()) {
          try {
            const bytes = api.readFile(f.path);
            const d = await digest(bytes);
            if (seen.get(f.path) === d) continue;
            seen.set(f.path, d);
            await keep(f.path.split("/").pop() || "artwork", bytes);
            setStatus(`Saved ${f.path}`);
          } catch (err) {
            setError(`Couldn't keep ${f.path}: ${(err as Error).message}`);
          }
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [props.engine, props.file?.url]);

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener("beforeunload", guard);
    return () => removeEventListener("beforeunload", guard);
  }, [dirty]);

  return (
    <div className="engine-frame" role="dialog" aria-label={name}>
      <div className="engine-bar">
        <button
          className="chip"
          onClick={() => {
            if (
              dirty &&
              !confirm(`${name} has unsaved changes. Close it anyway?`)
            )
              return;
            props.onClose();
          }}
        >
          ← Back
        </button>
        <strong>{name}</strong>
        <span className="muted small">{status}</span>
        {dirty && <span className="tag assumed">unsaved</span>}
        {saved.length > 0 && (
          <span className="muted small">
            {saved.length} {saved.length === 1 ? "save" : "saves"} kept in the
            project
          </span>
        )}
        {props.engine === "mantelcad" && (
          <span className="muted small">
            Saving back to Mantel isn't connected for MantelCAD yet.
          </span>
        )}
        {error && (
          <span className="error small" role="alert">
            {error}
          </span>
        )}
      </div>
      {deployed === false ? (
        <div className="engine-missing">
          <h2>{name} isn't available here yet</h2>
          <p className="muted">
            Its browser build hasn't been deployed to this Mantel. Builds are
            published with each release.
          </p>
        </div>
      ) : deployed ? (
        <iframe ref={frame} title={name} src={src} className="engine-iframe" />
      ) : null}
    </div>
  );
}
