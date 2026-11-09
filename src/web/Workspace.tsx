import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  call,
  can,
  connectLive,
  download,
  request,
  saveBlob,
  send,
  type Activity,
  type Facts,
  type Me,
  type ParamSpec,
  type Revision,
  type Workspace as WorkspaceData,
} from "./api";
import { ChatPanel } from "./ChatPanel";
import { DesignSheetView } from "./DesignSheet";
import { menuLabel, type DesignSheet } from "./design-sheet";
import { Timeline } from "./Timeline";
import { InspectPanel, type Picked } from "./InspectPanel";
import { ChecksPanel } from "./ChecksPanel";
import { overlayTones, type Toggles } from "./checks";
import { dimensionEdit, dragAxis, dragValue } from "./adjust";
import type { DimensionRecord } from "../shared/inspect-types";
import type { Check, CheckResult, Target } from "../shared/checks";
import { materialsUsed, pickFace, type InspectRecord } from "./inspect";
import catalog from "../../engine/lib/mantel/catalog.json";
import { ActionForm, type Preset } from "./ActionForm";
import {
  applyPick,
  fieldsFor,
  submitValues,
  type ActionSchema,
  type FormValues,
} from "./forms";
import { ghostShape } from "./ghost";
import { refFromPick } from "./refs";
import { Toolbar, type ToolbarAction } from "./Toolbar";
import { asOfLabel } from "./timeline-chips";
import { diffLines } from "./diff";
import { changedModel, initialModel } from "./follow";
import { agentStart, type ConnectedApp } from "./empty";
import type { ThemeChoice } from "./theme";
import sample from "../../examples/bridge.py?raw";
const Viewer = lazy(() =>
  import("./Viewer").then((module) => ({ default: module.Viewer })),
);

/** What the toy is made of, from the materials its model declares. */
function Materials({ record }: { record: InspectRecord }) {
  const { used, undeclared, total_g } = materialsUsed(record);
  return (
    <section className="materials" aria-label="Materials">
      <strong>Materials</strong>
      {used.length === 0 ? (
        <p className="muted">This build declares no materials.</p>
      ) : (
        <dl className="facts">
          {used.map((use) => (
            <div className="fact-row" key={use.name}>
              <dt>
                {use.name} · {use.parts.join(", ")}
              </dt>
              <dd>{use.mass_g.toFixed(2)} g</dd>
            </div>
          ))}
          {undeclared.length > 0 ? (
            <>
              <dt>Not declared · {undeclared.join(", ")}</dt>
              <dd>unknown</dd>
            </>
          ) : (
            <>
              <dt>Total mass</dt>
              <dd>{total_g.toFixed(2)} g</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
const briefTemplate = `# Manufacturing brief — DRAFT\n\nQuantity: TBD\nMaterial and grade: TBD\nProcess: TBD with manufacturer\nFinish and colour: TBD\nCritical dimensions and tolerances: TBD\nArtwork and engraving: TBD\nAssembly and adhesives: TBD\nInspection and sample approval: Required\nPackaging and shipping: TBD\n\nOpen questions:\n- Confirm process and supplier capabilities.\n- Review dimensioned engineering drawings.\n- Approve a physical sample before batch production.\n`;
type Drawer = "code" | "downloads" | "documents" | "design" | "connect" | null;
type Props = {
  data: WorkspaceData;
  reload: () => Promise<WorkspaceData>;
  me: Me;
  theme: "light" | "dark";
  themeChoice: ThemeChoice;
  chooseTheme: (choice: ThemeChoice) => void;
  onBack: () => void;
  onExtensions: () => void;
  onSettings: () => void;
  onSignOut: () => void;
};
export function Workspace(props: Props) {
  const { data } = props;
  const projectId = data.project.id;
  const [activity, setActivity] = useState<Activity>({
    sessions: [],
    events: [],
  });
  const [connected, setConnected] = useState(false);
  const [modelId, setModelId] = useState(() => initialModel(data));
  const [follow, setFollow] = useState(true);
  const [viewNumber, setViewNumber] = useState(0);
  const [selection, setSelection] = useState<Picked | null>(null);
  // A second pick (shift-click) measures between the two.
  const [second, setSecond] = useState<Picked | null>(null);
  const [section, setSection] = useState<{
    axis: "x" | "y" | "z";
    offset: number;
  } | null>(null);
  const [record, setRecord] = useState<InspectRecord | null>(null);
  // An action form being filled in: a new step, or an existing one being edited.
  const [form, setForm] = useState<{
    action: ActionSchema & { id: string; title?: string };
    savedKey?: string;
    editing?: string;
    name: string;
    values: FormValues;
    active: string | null;
    error: string;
    busy: boolean;
  } | null>(null);
  const [savedActions, setSavedActions] = useState<ToolbarAction[]>([]);
  // The Checks panel, what it colours on the model, and a tick that refetches it on live changes.
  const [checksOpen, setChecksOpen] = useState(false);
  const [toggles, setToggles] = useState<Toggles>({
    overlap: true,
    clearance: true,
    draft: true,
  });
  const [checkState, setCheckState] = useState<{
    checks: Check[];
    results: CheckResult[];
  }>({ checks: [], results: [] });
  const [checksTick, setChecksTick] = useState(0);
  // A dimension being dragged, with its live (preview) value.
  const [drag, setDrag] = useState<{
    dim: DimensionRecord;
    value: number;
  } | null>(null);
  const dragRef = useRef<{ dim: DimensionRecord; value: number } | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  // What the agent is pointing at, until the person clicks.
  const [agentPoint, setAgentPoint] = useState<{
    jobId: string;
    faces: number[];
    parts: string[];
    message: string;
  } | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [menu, setMenu] = useState(false);
  const [chatOpen, setChatOpen] = useState(
    () => !matchMedia("(max-width: 760px)").matches,
  );
  const [error, setError] = useState("");
  // The member's connected apps, for the empty-project screen; null until known.
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const refresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function loadActivity() {
    setActivity(await call<Activity>("projects_activity", { projectId }));
  }
  useEffect(() => {
    void loadActivity().catch((e: Error) => setError(e.message));
    const stop = connectLive(
      projectId,
      (message) => {
        if (message.type === "highlight") {
          setAgentPoint(message);
          return;
        }
        if (message.type === "event")
          setActivity((current) => {
            if (current.events.some((e) => e.id === message.event.id))
              return current;
            const events = [...current.events, message.event];
            const kind = message.event.kind;
            // Session state (active, ended, title) comes from the server on these changes.
            if (kind === "prompt" || kind === "ended") void loadActivity();
            return {
              sessions: current.sessions.map((s) =>
                s.id === message.event.session_id
                  ? { ...s, last_event_at: message.event.created_at }
                  : s,
              ),
              events,
            };
          });
        else {
          setChecksTick((t) => t + 1);
          clearTimeout(refresh.current);
          refresh.current = setTimeout(
            () => void props.reload().catch(() => {}),
            250,
          );
        }
      },
      (open) => {
        setConnected(open);
        // Fill any gap from while the socket was down.
        if (open) void loadActivity().catch(() => {});
      },
    );
    return () => {
      stop();
      clearTimeout(refresh.current);
    };
  }, [projectId]);
  useEffect(() => {
    if (!data.models.some((m) => m.id === modelId) && data.models[0])
      setModelId(data.models[0].id);
  }, [data.models, modelId]);
  // Follow the model an agent creates or changes, as the view follows its newest revision.
  // Viewing an older revision turns following off.
  const seen = useRef(data);
  useEffect(() => {
    const changed = changedModel(seen.current, data);
    seen.current = data;
    if (changed && follow && changed !== modelId) {
      setModelId(changed);
      setSelection(null);
    }
  }, [data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu((open) => !open);
      } else if (e.key === "Escape") {
        if (menu) setMenu(false);
        else if (selection) {
          setSelection(null);
          setSecond(null);
        } else if (drawer) setDrawer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, selection, drawer]);

  const model = data.models.find((m) => m.id === modelId);
  const revisions = useMemo(
    () =>
      data.revisions
        .filter((r) => r.model_id === modelId)
        .sort((a, b) => a.number - b.number),
    [data.revisions, modelId],
  );
  const jobsFor = (r?: Revision) =>
    r ? data.jobs.filter((j) => j.revision_id === r.id) : [];
  const built = (r?: Revision) =>
    jobsFor(r).find((j) => j.status === "succeeded");
  const latest = revisions.at(-1);
  const viewed = follow
    ? latest
    : (revisions.find((r) => r.number === viewNumber) ?? latest);
  // Show the newest revision at or before the viewed one that has a model to display.
  const shown = [...revisions]
    .reverse()
    .find((r) => viewed && r.number <= viewed.number && built(r));
  const shownJob = built(shown);
  const facts: Facts | null = shownJob?.facts
    ? JSON.parse(shownJob.facts)
    : null;
  const artifacts = data.artifacts.filter((a) => a.job_id === shownJob?.id);
  const glb = artifacts.find((a) => a.name === "model.glb");
  const inspectArtifact = artifacts.find((a) => a.name === "inspect.json");
  const viewedJob = jobsFor(viewed)[0];
  const parts = facts?.parts?.map((p) => p.label).filter(Boolean) ?? [];
  const params = Object.entries(facts?.params ?? {});
  const running = activity.sessions.find((s) => s.active && !s.ended_at);
  const lastSession = activity.sessions[0];
  // Only the owner writes to a project; a demo is read-only for everyone else.
  const { me } = props;
  const owns = data.project.owner === me.email;
  const canEdit = owns && can(me, "models.edit") && can(me, "builds.run");
  const canDownload = can(me, "exports.download");
  const hasSource = owns || data.revisions.some((r) => r.source !== undefined);
  const [demo, setDemo] = useState(data.project.demo === 1);
  async function toggleDemo() {
    await send(`/api/settings/projects/${projectId}/demo`, "PATCH", {
      demo: !demo,
    });
    setDemo(!demo);
  }
  // The model's design sheet, reread whenever the workspace reloads (an agent may have changed it).
  const [sheet, setSheet] = useState<DesignSheet | null>(null);
  useEffect(() => {
    if (!model) {
      setSheet(null);
      return;
    }
    let cancelled = false;
    call<{ sheet: DesignSheet | null }>("design_get", { modelId: model.id })
      .then((r) => {
        if (!cancelled) setSheet(r.sheet ?? null);
      })
      // Without the sheet the menu entry reads "No design sheet yet", which is still safe.
      .catch(() => {
        if (!cancelled) setSheet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [model?.id, data]);
  // An empty project the member owns invites them to connect an agent, unless one already is.
  const empty = !data.models.length && owns;
  useEffect(() => {
    // Reloaded when the connect drawer closes, in case an app was connected meanwhile.
    if (!empty || drawer) return;
    let cancelled = false;
    void request("/api/settings/connected-apps")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setApps(json as ConnectedApp[]);
      })
      // Without the list the screen falls back to offering a connection, which is still correct.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [empty, drawer]);
  const start = empty ? agentStart(apps, data.project.name) : null;
  // The build's exact measurements, for picking faces and measuring between picks.
  useEffect(() => {
    setRecord(null);
    setSecond(null);
    if (!inspectArtifact) return;
    let cancelled = false;
    void request(`/api/artifacts/${inspectArtifact.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setRecord(json as InspectRecord);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inspectArtifact?.id]);
  const agentFaces =
    agentPoint && agentPoint.jobId === shownJob?.id ? agentPoint.faces : [];
  const tones = useMemo(
    () =>
      checksOpen && record
        ? overlayTones(record, checkState.results, checkState.checks, toggles)
        : { fail: [], warn: [] },
    [checksOpen, record, checkState, toggles],
  );
  const canMeasure = owns && can(me, "builds.run");
  /** An exact distance from a measure job on the shown build, polling until it settles. */
  async function measureExactly(a: Target, b: Target): Promise<string> {
    if (!shownJob) throw new Error("No build to measure");
    for (let attempt = 0; attempt < 60; attempt++) {
      const r = await call<{
        status: string;
        distance?: number;
        error?: string;
        reason?: string;
        jobId?: string;
      }>("inspect_measure", { buildId: shownJob.id, a, b });
      if (r.status === "done") return `${r.distance!.toFixed(2)} mm`;
      if (r.status === "failed" || r.status === "unknown")
        throw new Error(r.error ?? r.reason ?? "Measure failed");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("The measure job is taking too long; try again shortly");
  }
  async function askAgent(text: string, refs: string) {
    await call("notes_add", {
      projectId,
      message: `${text}\n\nSelection: ${refs}`,
    });
  }
  const highlights = useMemo(
    () => [
      {
        faces: [selection?.face, second?.face].filter(
          (f): f is number => f !== undefined,
        ),
        tone: "pick" as const,
      },
      { faces: agentFaces, tone: "agent" as const },
      { faces: tones.fail, tone: "fail" as const },
      { faces: tones.warn, tone: "warn" as const },
    ],
    [
      selection?.face,
      second?.face,
      agentFaces.join(","),
      tones.fail.join(","),
      tones.warn.join(","),
    ],
  );
  const bounds = useMemo(() => {
    if (!record?.parts.length) return null;
    const axes = { x: 0, y: 1, z: 2 } as const;
    return Object.fromEntries(
      Object.entries(axes).map(([axis, k]) => [
        axis,
        [
          Math.min(...record.parts.map((p) => p.bbox.min[k])),
          Math.max(...record.parts.map((p) => p.bbox.max[k])),
        ],
      ]),
    ) as Record<"x" | "y" | "z", [number, number]>;
  }, [record]);
  // Tell the agent what the owner has selected, as references that survive rebuilds.
  useEffect(() => {
    if (!owns || !model) return;
    const refs = [selection, second]
      .filter((p): p is Picked => !!p)
      .map((p) =>
        p.face !== undefined && record?.faces[p.face]
          ? refFromPick(record, p.face)
          : { ref: "part", label: p.label },
      );
    const timer = setTimeout(() => {
      void call("selection_set", { modelId: model.id, refs }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [
    selection?.label,
    selection?.face,
    second?.label,
    second?.face,
    model?.id,
    record,
  ]);
  const paramValues = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(facts?.params ?? {}).map(([k, v]) => [k, v.value]),
      ),
    [facts],
  );
  const paramNames = Object.entries(facts?.params ?? {})
    .filter(([, v]) => !v.unit || v.unit === "mm")
    .map(([k]) => k);
  const planeNames = (facts?.steps ?? [])
    .filter((s) => s.action === "plane")
    .map((s) => s.name);
  const builtins = (
    catalog.actions as unknown as (ActionSchema & ToolbarAction)[]
  ).filter((a) => a.id !== "custom");
  async function loadCatalog() {
    try {
      const listed = await call<{ actions: ToolbarAction[] }>("actions_list", {
        projectId,
        category: "Custom",
      });
      setSavedActions(listed.actions.filter((a) => a.id.includes("@")));
      setPresets(await call<Preset[]>("presets_list", { projectId }));
    } catch {
      // The toolbar still offers the built-in actions.
    }
  }
  async function openAction(
    id: string,
    editing?: { name: string; inputs: FormValues },
  ) {
    let action: (ActionSchema & { id: string; title?: string }) | undefined =
      builtins.find((a) => a.id === id);
    let savedKey: string | undefined;
    let values = editing?.inputs ?? {};
    if (!action) {
      const key = id === "custom" ? String(editing?.inputs.action ?? "") : id;
      action = await call("actions_describe", { id: key, projectId });
      savedKey = key;
      const { action: _key, ...rest } = values as FormValues & {
        action?: string;
      };
      values = rest;
    }
    const used = new Set((facts?.steps ?? []).map((s) => s.name));
    let name = action!.title ?? action!.id;
    for (let n = 2; used.has(name); n++)
      name = `${action!.title ?? action!.id} ${n}`;
    setSelection(null);
    setSecond(null);
    setForm({
      action: action!,
      savedKey,
      editing: editing?.name,
      name: editing?.name ?? name,
      values,
      active:
        fieldsFor(action!, values).find(
          (f) => f.visible && (f.kind === "ref" || f.kind === "list"),
        )?.name ?? null,
      error: "",
      busy: false,
    });
  }
  async function submitForm() {
    if (!form || !model || !latest) return;
    const inputs = submitValues(form.action, form.values);
    const body = form.savedKey ? { ...inputs, action: form.savedKey } : inputs;
    setForm({ ...form, busy: true, error: "" });
    try {
      if (form.editing)
        await call("steps_edit", {
          modelId: model.id,
          expectedRevision: latest.number,
          name: form.editing,
          inputs: body,
        });
      else
        await call("steps_add", {
          modelId: model.id,
          expectedRevision: latest.number,
          action: form.savedKey ? "custom" : form.action.id,
          name: form.name.trim(),
          inputs: body,
        });
      setForm(null);
      setFollow(true);
      await props.reload();
    } catch (e) {
      setForm(
        (f) =>
          f && {
            ...f,
            busy: false,
            error: e instanceof Error ? e.message : "The step was not saved",
          },
      );
    }
  }
  async function savePreset(name: string, description: string) {
    if (!form) return;
    const id =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "preset";
    const existing = presets.find((p) => p.id === id);
    try {
      await call("presets_save", {
        projectId,
        id: /^[a-z]/.test(id) ? id : `p-${id}`,
        expectedVersion: existing?.version ?? 0,
        action: form.savedKey ?? form.action.id,
        name,
        description,
        inputs: submitValues(form.action, form.values),
      });
      setPresets(await call<Preset[]>("presets_list", { projectId }));
    } catch (e) {
      setForm(
        (f) =>
          f && {
            ...f,
            error: e instanceof Error ? e.message : "The preset was not saved",
          },
      );
    }
  }
  // A pick while a form waits for one fills that field instead of selecting.
  function pickIntoForm(
    label: string,
    hit: [number, number, number] | undefined,
  ) {
    if (!form?.active) return false;
    const fields = fieldsFor(form.action, form.values);
    const field = fields.find((f) => f.name === form.active);
    const kinds = field?.refKinds ?? [];
    let ref: unknown;
    if (kinds.includes("face") || kinds.includes("edges")) {
      const face = record && hit ? pickFace(record, label, hit) : null;
      if (face === null) {
        setForm({ ...form, error: "Click a face of the model" });
        return true;
      }
      const picked = refFromPick(record!, face);
      if (kinds.includes("face")) ref = picked;
      else if (picked.ref === "face" && "name" in picked)
        ref = { ref: "edges", of: picked.of, around: picked.name };
      else {
        setForm({
          ...form,
          error: "For edges, pick a named face or a side such as top",
        });
        return true;
      }
    } else if (kinds.includes("part")) ref = { ref: "part", label };
    else return false;
    const next = applyPick(fields, form.values, form.active, ref);
    setForm({ ...form, values: next.values, active: next.next, error: "" });
    return true;
  }
  const ghost =
    form && record
      ? ghostShape(
          form.savedKey ? "custom" : form.action.id,
          form.values,
          record,
          paramValues,
        )
      : null;
  const toolbarReason = () =>
    !canEdit
      ? "Only the project owner can add steps"
      : !facts?.steps
        ? "This model has no steps section; ask the agent to adopt the standard layout"
        : !editable
          ? "View the latest revision to add steps"
          : undefined;
  // The model as it was after one step, from a view-as-of preview build.
  const [asOf, setAsOf] = useState<{
    step: string;
    revisionId: string;
    glb?: string;
    error?: string;
  } | null>(null);
  useEffect(() => setAsOf(null), [modelId, shown?.id]);
  async function viewAsOf(step: string) {
    if (!shown) return;
    const revisionId = shown.id;
    setAsOf({ step, revisionId });
    try {
      let job = await call<{ id: string; status: string }>(
        "builds_view_as_of",
        {
          revisionId,
          step,
        },
      );
      for (
        let i = 0;
        i < 90 && job.status !== "succeeded" && job.status !== "failed";
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        job = await call("builds_get", { jobId: job.id });
      }
      const result = job as {
        status: string;
        error?: string;
        artifacts?: { id: string; name: string }[];
      };
      const glbId = result.artifacts?.find((a) => a.name === "model.glb")?.id;
      setAsOf((current) =>
        current?.step === step && current.revisionId === revisionId
          ? glbId
            ? { ...current, glb: glbId }
            : { ...current, error: result.error ?? "The preview did not build" }
          : current,
      );
    } catch (e) {
      setAsOf((current) =>
        current?.step === step
          ? {
              ...current,
              error:
                e instanceof Error ? e.message : "The preview did not build",
            }
          : current,
      );
    }
  }
  const editable =
    canEdit &&
    !!latest &&
    shown?.id === latest.id &&
    viewed?.id === latest.id &&
    !!shownJob;
  /** Adjustment A and B: one models_set_parameter call for the dimension's parameter. */
  async function adjust(dim: DimensionRecord, value: number) {
    const edit = dimensionEdit(dim, facts?.params ?? {}, value);
    if ("error" in edit) throw new Error(edit.error);
    if (!model || !latest) throw new Error("No model to change");
    await call("models_set_parameter", {
      modelId: model.id,
      expectedRevision: latest.number,
      name: edit.name,
      value: edit.value,
    });
    setFollow(true);
    await props.reload();
  }
  const fine = useMemo(() => matchMedia("(pointer: fine)").matches, []);
  const dragDim =
    editable && fine && !asOf && record && selection?.face !== undefined
      ? record.dimensions?.find(
          // Either face of a dimension offers the handle; it moves the declared face.
          (d) => d.faces.includes(selection.face!) && dragAxis(record, d),
        )
      : undefined;
  const dragLine = dragDim && record ? dragAxis(record, dragDim) : null;
  const dragSpec = dragDim?.param ? facts?.params?.[dragDim.param] : undefined;
  const handle =
    dragDim && dragLine && dragSpec && shownJob
      ? {
          key: `${shownJob.id}-${dragDim.name}`,
          origin: dragLine.origin,
          direction: dragLine.direction,
          onMove: (along: number) => {
            dragRef.current = {
              dim: dragDim,
              value: dragValue(dragDim, dragSpec, along, dragLine.sign),
            };
            setDrag(dragRef.current);
          },
          onRelease: () => {
            // One commit per release, read from the ref rather than inside a state update.
            const released = dragRef.current;
            dragRef.current = null;
            setDrag(null);
            if (released && released.value !== released.dim.value)
              void adjust(released.dim, released.value).catch((e: Error) =>
                setError(e.message),
              );
          },
          onCancel: () => {
            dragRef.current = null;
            setDrag(null);
          },
        }
      : null;
  const dragGhost =
    drag && dragLine && record
      ? {
          kind: "plane" as const,
          origin: dragLine.origin.map(
            (v, k) =>
              v +
              dragLine.direction[k] *
                (drag.value - drag.dim.value) *
                dragLine.sign,
          ) as [number, number, number],
          normal: dragLine.direction,
          size: Math.sqrt(record.faces[drag.dim.moves!]?.area ?? 1),
        }
      : null;

  function viewRevision(r: Revision) {
    setFollow(r.id === latest?.id);
    setViewNumber(r.number);
    setSelection(null);
    if (r.model_id !== modelId) setModelId(r.model_id);
  }

  const status = running
    ? `Agent working${latest ? ` · revision ${latest.number}` : ""}`
    : lastSession?.ended_at
      ? "Agent finished"
      : activity.events.length
        ? "Agent idle"
        : "No agent yet";
  return (
    <div className="workspace">
      <Suspense fallback={<div className="viewer" />}>
        <Viewer
          artifactId={asOf?.glb ?? glb?.id}
          modelKey={modelId}
          theme={props.theme}
          parts={parts}
          selected={
            selection && selection.face === undefined ? selection.label : null
          }
          record={asOf ? null : record}
          highlights={highlights}
          section={asOf ? null : section}
          ghost={asOf ? null : (dragGhost ?? ghost)}
          handle={handle}
          onSelect={(label, point, hit, additive) => {
            setAgentPoint(null);
            if (label && pickIntoForm(label, hit)) return;
            if (!label) {
              setSelection(null);
              setSecond(null);
              return;
            }
            const face =
              record && hit
                ? (pickFace(record, label, hit) ?? undefined)
                : undefined;
            const picked = { label, ...point, face };
            if (additive && selection) setSecond(picked);
            else {
              setSelection(picked);
              setSecond(null);
            }
          }}
        />
      </Suspense>

      <header className="topbar">
        <div className="topbar-left">
          <button
            className="chip brand"
            onClick={props.onBack}
            title="All projects"
          >
            <span className="mark" aria-hidden="true" />
            Mantel
          </button>
          <span className="chip project-name">{data.project.name}</span>
          {!owns && <span className="chip demo-chip">Demo · view only</span>}
          {data.models.length > 1 && (
            <select
              className="chip"
              aria-label="Model"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setFollow(true);
                setSelection(null);
              }}
            >
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="topbar-right">
          {model && (
            <button
              className={`chip checks-chip wide-only ${checksOpen ? "on" : ""}`}
              aria-pressed={checksOpen}
              onClick={() => setChecksOpen(!checksOpen)}
            >
              Checks
            </button>
          )}
          <Toolbar
            actions={[...builtins, ...savedActions]}
            disabledReason={toolbarReason()}
            onOpen={() => void loadCatalog()}
            onChoose={(id) => void openAction(id)}
          />
          <span
            className="chip status"
            title={connected ? "Live" : "Reconnecting…"}
          >
            <span
              className={`dot ${running ? "on" : ""} ${connected ? "" : "offline"}`}
            />
            <span className="status-text">
              {connected ? status : "Reconnecting…"}
            </span>
          </span>
          <button
            className="chip icon"
            aria-label="Menu"
            aria-expanded={menu}
            title="Menu (⌘K)"
            onClick={() => setMenu(!menu)}
          >
            ⋯
          </button>
        </div>
        {menu && (
          <Menu
            onClose={() => setMenu(false)}
            choice={props.themeChoice}
            chooseTheme={props.chooseTheme}
            open={(d) => {
              setDrawer(d);
              setMenu(false);
            }}
            onExtensions={props.onExtensions}
            onSettings={props.onSettings}
            onSignOut={props.onSignOut}
            hasSource={hasSource}
            sheetLabel={menuLabel(sheet)}
            hasSheet={!!sheet}
            demo={
              owns && can(me, "settings.manage")
                ? {
                    on: demo,
                    toggle: () =>
                      void toggleDemo().catch((e: Error) =>
                        setError(e.message),
                      ),
                  }
                : undefined
            }
          />
        )}
      </header>

      <div className={`chat-shell ${chatOpen ? "open" : ""}`}>
        <button className="chat-toggle" onClick={() => setChatOpen(!chatOpen)}>
          {chatOpen ? "Hide activity" : "Agent activity"}
          {running && <span className="dot on" />}
        </button>
        {chatOpen && (
          <ChatPanel
            activity={activity}
            revisions={data.revisions}
            jobs={data.jobs}
            me={props.me.email}
            onViewRevision={viewRevision}
          />
        )}
      </div>

      {start && (
        <div className="canvas-empty">
          <span className="mark large" aria-hidden="true" />
          <h2>{start.heading}</h2>
          <p>{start.body}</p>
          <div className="row">
            <button
              className={apps?.length ? "secondary" : undefined}
              onClick={() => setDrawer("connect")}
            >
              {start.connectLabel}
            </button>
            <button className="secondary" onClick={() => setDrawer("code")}>
              Write the model yourself
            </button>
          </div>
        </div>
      )}

      {form && (
        <ActionForm
          action={form.action}
          editing={form.editing}
          name={form.name}
          values={form.values}
          active={form.active}
          params={paramNames}
          planes={planeNames}
          presets={presets.filter(
            (p) => p.action === (form.savedKey ?? form.action.id),
          )}
          error={form.error}
          busy={form.busy}
          canSavePreset={canEdit}
          onName={(name) => setForm({ ...form, name })}
          onValues={(values) => setForm({ ...form, values })}
          onActive={(active) => setForm({ ...form, active })}
          onSubmit={() => void submitForm()}
          onSavePreset={(name, description) =>
            void savePreset(name, description)
          }
          onClose={() => setForm(null)}
        />
      )}

      {agentPoint && agentPoint.jobId === shownJob?.id && (
        <div className="agent-point" role="status">
          <span className="dot on" aria-hidden="true" />
          <span>
            {agentPoint.message || "The agent is pointing at this"}
            {agentPoint.parts.length ? ` · ${agentPoint.parts.join(", ")}` : ""}
          </span>
          <button className="link" onClick={() => setAgentPoint(null)}>
            Dismiss
          </button>
        </div>
      )}

      {record && bounds && !asOf && (
        <div className="inspect-tools" role="group" aria-label="Section">
          {/* On phones the top bar has no room; Checks sits with the section tools. */}
          <button
            className={`chip checks-chip narrow-only ${checksOpen ? "on" : ""}`}
            aria-pressed={checksOpen}
            onClick={() => setChecksOpen(!checksOpen)}
          >
            Checks
          </button>
          {(["x", "y", "z"] as const).map((axis) => (
            <button
              key={axis}
              className={`chip ${section?.axis === axis ? "on" : ""}`}
              aria-pressed={section?.axis === axis}
              onClick={() =>
                setSection(
                  section?.axis === axis
                    ? null
                    : { axis, offset: (bounds[axis][0] + bounds[axis][1]) / 2 },
                )
              }
            >
              Cut {axis.toUpperCase()}
            </button>
          ))}
          {section && (
            <input
              type="range"
              aria-label={`Section position along ${section.axis.toUpperCase()}`}
              min={bounds[section.axis][0]}
              max={bounds[section.axis][1]}
              step={0.1}
              value={section.offset}
              onChange={(e) =>
                setSection({ ...section, offset: Number(e.target.value) })
              }
            />
          )}
          {section && (
            <span className="muted small">{section.offset.toFixed(1)} mm</span>
          )}
        </div>
      )}

      {checksOpen && model && shown && (
        <ChecksPanel
          modelId={model.id}
          revision={shown.number}
          record={asOf ? null : record}
          picks={[selection, second]
            .filter((p): p is Picked => !!p)
            .map((p) => ({ label: p.label, face: p.face }))}
          canEdit={canEdit}
          canMeasure={canMeasure}
          refresh={`${checksTick}-${shownJob?.id}`}
          toggles={toggles}
          onToggles={setToggles}
          onResults={(checks, results) => setCheckState({ checks, results })}
          onClose={() => setChecksOpen(false)}
        />
      )}

      {selection && record && (selection.face !== undefined || second) && (
        <InspectPanel
          onMeasure={canMeasure ? measureExactly : undefined}
          onAdjust={editable ? adjust : undefined}
          onAsk={owns && can(me, "notes.write") ? askAgent : undefined}
          key={`${selection.label}-${selection.face}-${second?.label}-${second?.face}-${shown?.id}`}
          record={record}
          first={selection}
          second={second}
          onShowPart={() => {
            setSelection({ ...selection, face: undefined });
            setSecond(null);
          }}
          onClose={() => {
            setSelection(null);
            setSecond(null);
          }}
        />
      )}

      {selection && !(record && (selection.face !== undefined || second)) && (
        <PartPopover
          key={`${selection.label}-${shown?.id}`}
          label={selection.label}
          at={selection}
          params={params.filter(([, s]) => s.part === selection.label)}
          editable={editable}
          building={
            viewedJob?.status === "queued" || viewedJob?.status === "running"
          }
          readOnly={!canEdit}
          onClose={() => setSelection(null)}
          onApply={async (name, value) => {
            if (!model || !latest) return;
            await call("models_set_parameter", {
              modelId: model.id,
              expectedRevision: latest.number,
              name,
              value,
            });
            setFollow(true);
            await props.reload();
          }}
        />
      )}

      {model && latest && facts?.steps && (
        <Timeline
          key={shownJob?.id}
          modelId={model.id}
          revision={latest.number}
          steps={facts.steps}
          incomplete={!!facts.incomplete}
          building={
            viewedJob?.status === "queued" || viewedJob?.status === "running"
          }
          editable={editable}
          onChanged={async () => {
            setFollow(true);
            await props.reload();
          }}
          onViewAsOf={viewAsOf}
          onEdit={async (name) => {
            if (!model) return;
            const { steps } = await call<{
              steps: { action: string; name: string; inputs: FormValues }[];
            }>("steps_list", { modelId: model.id });
            const step = steps.find((s) => s.name === name);
            if (step)
              await openAction(step.action, { name, inputs: step.inputs });
          }}
        />
      )}

      {asOf && facts?.steps && (
        <div className="asof-banner" role="status">
          <strong>{asOfLabel(facts.steps, asOf.step)}</strong>
          <span>
            {asOf.error ??
              (asOf.glb ? "Later steps are hidden." : "Building the preview…")}
          </span>
          <button className="link" onClick={() => setAsOf(null)}>
            Back to latest
          </button>
        </div>
      )}

      {viewedJob?.status === "failed" && (
        <div className="build-banner" role="alert">
          <strong>Revision {viewed?.number} failed to build.</strong>
          <span>{viewedJob.error?.split("\n").at(-2) ?? viewedJob.error}</span>
          {hasSource && (
            <button className="link" onClick={() => setDrawer("code")}>
              View code
            </button>
          )}
        </div>
      )}

      {!!revisions.length && (
        <nav className="revisions" aria-label="Revisions">
          {revisions.slice(-12).map((r) => {
            const job = jobsFor(r)[0];
            return (
              <button
                key={r.id}
                className={`pill ${viewed?.id === r.id ? "on" : ""}`}
                onClick={() => viewRevision(r)}
                title={job ? `Build ${job.status}` : "Not built"}
              >
                <span className={`state ${job?.status ?? "none"}`} />r{r.number}
              </button>
            );
          })}
          {!follow && (
            <button className="pill follow" onClick={() => setFollow(true)}>
              Follow live
            </button>
          )}
        </nav>
      )}

      {drawer && (
        <aside className="drawer" aria-label={drawer}>
          <div className="drawer-head">
            <h2>
              {
                {
                  code: "Source code",
                  downloads: "Downloads and facts",
                  documents: "Manufacturing documents",
                  design: "Design sheet",
                  connect: "Connect an agent",
                }[drawer]
              }
            </h2>
            <button
              className="icon ghost"
              aria-label="Close"
              onClick={() => setDrawer(null)}
            >
              ×
            </button>
          </div>
          <div className="drawer-body">
            {drawer === "code" && (
              <CodeDrawer
                key={`${modelId}-${viewed?.id}`}
                revision={viewed}
                previous={revisions.find(
                  (r) => r.number === (viewed?.number ?? 0) - 1,
                )}
                error={viewedJob?.status === "failed" ? viewedJob.error : null}
                readOnly={!owns || !can(me, "models.edit")}
                onSave={async (source, build) => {
                  let id = model?.id;
                  if (!id)
                    id = (
                      await call<{ id: string }>("models_create", {
                        projectId,
                        name: "Model 01",
                      })
                    ).id;
                  const saved = await call<{ id: string }>("models_save", {
                    modelId: id,
                    expectedRevision: model?.revision ?? 0,
                    source,
                  });
                  if (build)
                    await call("models_build", { revisionId: saved.id });
                  setModelId(id);
                  setFollow(true);
                  await props.reload();
                }}
              />
            )}
            {drawer === "downloads" && (
              <div className="stack">
                {shown ? (
                  <p className="muted">
                    Revision {shown.number}. Exports always belong to one saved
                    revision.
                  </p>
                ) : (
                  <p className="muted">No built revision yet.</p>
                )}
                {!canDownload && (
                  <p className="muted">
                    Downloads need the “Download exports” permission.
                  </p>
                )}
                <div className="downloads">
                  {(canDownload ? artifacts : []).map((a) => (
                    <button
                      key={a.id}
                      className="secondary"
                      onClick={() =>
                        void download(a.id, a.name).catch((e: Error) =>
                          setError(e.message),
                        )
                      }
                    >
                      ↓ {a.name}
                    </button>
                  ))}
                </div>
                {canDownload &&
                  artifacts.length > 0 &&
                  !artifacts.some((a) => a.name === "blueprint.pdf") && (
                    <p className="muted">
                      The blueprint appears here a minute or two after a build
                      finishes. If none appears, the drawing failed or the build
                      is older than blueprints; rebuild to try again.
                    </p>
                  )}
                {facts && (
                  <dl className="facts">
                    <dt>Size</dt>
                    <dd>
                      {facts.bounds.map((n) => n.toFixed(1)).join(" × ")} mm
                    </dd>
                    <dt>Solids</dt>
                    <dd>{facts.solids}</dd>
                    <dt>Volume</dt>
                    <dd title="Sum of part volumes; overlapping parts count twice">
                      {Math.round(facts.volume_mm3).toLocaleString()} mm³
                    </dd>
                    {facts.parts?.map((p) => (
                      <div className="fact-row" key={p.label}>
                        <dt>{p.label || "Unlabelled part"}</dt>
                        <dd>{Math.round(p.volume_mm3).toLocaleString()} mm³</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {record && <Materials record={record} />}
                <p className="muted">
                  A valid solid is not a manufacturing approval. Drawings, DFM
                  and a sample approval are separate reviews.
                </p>
              </div>
            )}
            {drawer === "documents" && (
              <Documents
                data={data}
                revisionId={shown?.id}
                reload={props.reload}
                readOnly={!owns || !can(me, "models.edit")}
              />
            )}
            {drawer === "design" &&
              (sheet ? (
                <DesignSheetView sheet={sheet} />
              ) : (
                <p className="muted">This model has no design sheet yet.</p>
              ))}
            {drawer === "connect" && (
              <Connect
                onSettings={() => {
                  setDrawer(null);
                  props.onSettings();
                }}
              />
            )}
          </div>
        </aside>
      )}

      {drag && (
        <div className="drag-value chip" role="status">
          {drag.dim.name} {drag.value.toFixed(2)} mm · preview · release to
          save, Esc to cancel
        </div>
      )}

      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="link" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function Menu(props: {
  onClose: () => void;
  open: (d: Drawer) => void;
  choice: ThemeChoice;
  chooseTheme: (c: ThemeChoice) => void;
  onExtensions: () => void;
  onSettings: () => void;
  onSignOut: () => void;
  hasSource: boolean;
  sheetLabel: string;
  hasSheet: boolean;
  demo?: { on: boolean; toggle: () => void };
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="menu" role="menu">
      {props.hasSource && (
        <button ref={first} role="menuitem" onClick={() => props.open("code")}>
          Source code <kbd>diff</kbd>
        </button>
      )}
      <button
        ref={props.hasSource ? undefined : first}
        role="menuitem"
        onClick={() => props.open("downloads")}
      >
        Downloads and facts
      </button>
      <button role="menuitem" onClick={() => props.open("documents")}>
        Manufacturing documents
      </button>
      <button
        role="menuitem"
        disabled={!props.hasSheet}
        onClick={() => props.open("design")}
      >
        {props.sheetLabel}
      </button>
      <button role="menuitem" onClick={() => props.open("connect")}>
        Connect an agent
      </button>
      {props.demo && (
        <button
          role="menuitem"
          onClick={() => {
            props.onClose();
            props.demo?.toggle();
          }}
        >
          {props.demo.on ? "Stop showing as demo" : "Show as demo"}
        </button>
      )}
      <hr />
      <button
        role="menuitem"
        onClick={() => {
          props.onClose();
          props.onSettings();
        }}
      >
        Settings
      </button>
      <button
        role="menuitem"
        onClick={() => {
          props.onClose();
          props.onExtensions();
        }}
      >
        Skills and tools
      </button>
      <div className="segmented" role="group" aria-label="Theme">
        {(["system", "light", "dark"] as const).map((c) => (
          <button
            key={c}
            className={props.choice === c ? "on" : ""}
            aria-pressed={props.choice === c}
            onClick={() => props.chooseTheme(c)}
          >
            {c === "system" ? "Auto" : c === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <hr />
      <button role="menuitem" onClick={props.onSignOut}>
        Sign out
      </button>
    </div>
  );
}

function PartPopover(props: {
  label: string;
  at: { x: number; y: number };
  params: [string, ParamSpec][];
  editable: boolean;
  building: boolean;
  readOnly: boolean;
  onClose: () => void;
  onApply: (name: string, value: number) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.params.map(([n, s]) => [n, String(s.value)])),
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function apply(name: string, spec: ParamSpec) {
    const value = Number(values[name]);
    if (!Number.isFinite(value)) return setError("Enter a number");
    if (value === spec.value) return;
    setBusy(name);
    setError("");
    try {
      await props.onApply(name, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Change was not saved");
    } finally {
      setBusy("");
    }
  }
  const style = {
    left: `min(max(12px, ${props.at.x + 16}px), calc(100% - 308px))`,
    top: `min(max(64px, ${props.at.y - 40}px), calc(100% - 320px))`,
  };
  return (
    <div
      className="popover"
      style={style}
      role="dialog"
      aria-label={`${props.label} dimensions`}
    >
      <div className="popover-head">
        <strong>{props.label}</strong>
        <button
          className="icon ghost"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      {!props.params.length && (
        <p className="muted small">
          No editable dimensions are declared for this part.
        </p>
      )}
      {props.params.map(([name, spec]) => (
        <label className="param" key={name}>
          <span>{name}</span>
          <span className="param-field">
            <input
              inputMode="decimal"
              value={values[name] ?? ""}
              disabled={!props.editable || props.building || !!busy}
              onChange={(e) => setValues({ ...values, [name]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void apply(name, spec);
              }}
              onBlur={() => void apply(name, spec)}
              aria-describedby={`${name}-range`}
            />
            <span className="unit">{spec.unit ?? ""}</span>
          </span>
          {(spec.min !== undefined || spec.max !== undefined) && (
            <small id={`${name}-range`} className="muted">
              {spec.min ?? "…"}–{spec.max ?? "…"}
            </small>
          )}
        </label>
      ))}
      {!props.editable && !!props.params.length && (
        <p className="muted small">
          {props.readOnly
            ? "Dimensions are view only here."
            : "Viewing an older revision. Follow live to edit."}
        </p>
      )}
      {props.building && (
        <p className="muted small">
          A build is running; edit when it finishes.
        </p>
      )}
      {busy && <p className="muted small">Saving and rebuilding…</p>}
      {error && (
        <p className="inline-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function CodeDrawer(props: {
  revision?: Revision;
  previous?: Revision;
  error: string | null;
  readOnly: boolean;
  onSave: (source: string, build: boolean) => Promise<void>;
}) {
  const original = props.revision?.source ?? (props.readOnly ? "" : sample);
  const [source, setSource] = useState(original);
  const [mode, setMode] = useState<"view" | "edit" | "diff">(
    props.revision ? "view" : "edit",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = source !== original;
  const diff =
    props.previous && mode === "diff"
      ? diffLines(props.previous.source ?? "", original)
      : null;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(build: boolean) {
    setBusy(true);
    setError("");
    try {
      await props.onSave(source, build);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Code view">
        <button
          className={mode === "view" ? "on" : ""}
          onClick={() => setMode("view")}
          disabled={!props.revision}
        >
          {props.revision ? `Revision ${props.revision.number}` : "New"}
        </button>
        <button
          className={mode === "diff" ? "on" : ""}
          onClick={() => setMode("diff")}
          disabled={!props.previous}
        >
          Changes
        </button>
        {!props.readOnly && (
          <button
            className={mode === "edit" ? "on" : ""}
            onClick={() => setMode("edit")}
          >
            Edit
          </button>
        )}
      </div>
      {props.error && <pre className="code error-block">{props.error}</pre>}
      {mode === "view" && <pre className="code">{original}</pre>}
      {mode === "diff" &&
        (diff ? (
          <pre className="code diff">
            {diff.map((line, i) => (
              <span key={i} className={line.kind}>
                {line.kind === "add"
                  ? "+ "
                  : line.kind === "remove"
                    ? "− "
                    : "  "}
                {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
        ) : (
          <p className="muted">This change is too large to compare here.</p>
        ))}
      {mode === "edit" && !props.readOnly && (
        <>
          <textarea
            className="code editor"
            spellCheck={false}
            aria-label="Python model source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <p className="muted small">
            Define <code>build()</code> and return build123d parts. Units: mm.
            Saving creates a new revision; it never overwrites one.
          </p>
          <div className="row">
            <button
              className="secondary"
              disabled={busy || (!dirty && !!props.revision)}
              onClick={() => void save(false)}
            >
              Save revision
            </button>
            <button
              disabled={busy || (!dirty && !!props.revision)}
              onClick={() => void save(true)}
            >
              Save and build
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Documents(props: {
  data: WorkspaceData;
  revisionId?: string;
  reload: () => Promise<WorkspaceData>;
  readOnly: boolean;
}) {
  const [content, setContent] = useState(briefTemplate);
  const [revisionId, setRevisionId] = useState(props.revisionId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data } = props;
  return (
    <div className="stack">
      {props.readOnly ? (
        <p className="muted">
          Manufacturing notes for this project. They are view only here.
        </p>
      ) : (
        <>
          <p className="muted">
            Record materials, finishes, tolerances, assembly and inspection
            needs. New entries keep previous versions.
          </p>
          <label>
            Revision
            <select
              value={revisionId}
              onChange={(e) => setRevisionId(e.target.value)}
            >
              <option value="">Whole project</option>
              {data.revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {data.models.find((m) => m.id === r.model_id)?.name} ·
                  revision {r.number}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="code editor short"
            value={content}
            maxLength={30000}
            onChange={(e) => setContent(e.target.value)}
          />
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              call("documents_add", {
                projectId: data.project.id,
                revisionId: revisionId || undefined,
                kind: "manufacturing-brief",
                title: "Manufacturing brief",
                content,
              })
                .then(() => props.reload())
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Save draft brief
          </button>
        </>
      )}
      {error && <p className="inline-error">{error}</p>}
      {data.documents.map((d) => (
        <article className="doc" key={d.id}>
          <div className="doc-head">
            <strong>{d.title}</strong>
            <span className="tag">Draft · v{d.version}</span>
          </div>
          <p className="muted small">
            {d.model_revision_id
              ? `Revision ${data.revisions.find((r) => r.id === d.model_revision_id)?.number}`
              : "Whole project"}
          </p>
          <pre>{d.content}</pre>
          <div className="row">
            {!props.readOnly && (
              <button
                className="secondary"
                onClick={() => setContent(d.content)}
              >
                Use as next draft
              </button>
            )}
            <button
              className="ghost"
              onClick={() =>
                saveBlob(
                  new Blob([d.content], {
                    type: "text/markdown;charset=utf-8",
                  }),
                  `${d.kind}-v${d.version}.md`,
                )
              }
            >
              Download
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Connect(props: { onSettings: () => void }) {
  return (
    <div className="stack">
      <p>
        Add this server URL to your AI app, such as a custom connector in Claude
        or an HTTP MCP server in Claude Code. When it asks, sign in to Mantel
        and select <strong>Allow</strong>.
      </p>
      <label>
        Server URL
        <input
          readOnly
          value={`${location.origin}/mcp`}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <p className="muted">
        To have your AI set itself up, copy the instructions in{" "}
        <button className="link" onClick={props.onSettings}>
          Settings → Connected apps
        </button>{" "}
        and paste them into it. Apps you allow are listed there too.
      </p>
      <pre className="code">{`session_start  → your prompt appears here
session_update → short progress notes
models_save → models_build → builds_get
session_end    → a summary of the result`}</pre>
      <p className="muted small">
        The agent reads the modeling skill with <code>skills_list</code>. Notes
        you leave here reach it on its next tool call.
      </p>
    </div>
  );
}
