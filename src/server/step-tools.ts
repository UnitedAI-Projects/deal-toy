import { z } from "zod";
import { recordEvent, sessionFor } from "./activity";
import {
  actions,
  catalogIndex,
  getAction,
  stepStates,
  type StepLog,
} from "./actions/catalog";
import {
  applyStepChange,
  describeChange,
  type StepChange,
} from "./actions/ops";
import {
  publicStep,
  readSteps,
  writeSteps,
  type StepValue,
} from "./actions/script";
import {
  presetFor,
  savedAction,
  savedIndex,
  SAVED_KEY,
  visiblePresets,
  visibleSaved,
} from "./actions/saved";
import { validateInputs } from "./actions/validate";
import { AppError, id, modelAccess, projectAccess, type Context } from "./core";
import {
  define,
  PLAN_NOTE,
  queueBuild,
  saveRevision,
  type Tool,
} from "./tool-kit";

/** The modeling-action tools: the self-describing catalog, and edits to a model's steps section. */
const stepName = z.string().min(1).max(80);
const inputs = z.record(z.string(), z.unknown());
const target = {
  modelId: id,
  expectedRevision: z.number().int().positive(),
};
const WRITE = ["models.edit", "builds.run"] as const;

const seesSource = (c: Context, owner: string) =>
  owner === c.identity.email || c.identity.permissions.has("exports.download");

async function latestFacts(c: Context, revisionId: string) {
  const job = await c.env.DB.prepare(
    "SELECT facts FROM jobs WHERE revision_id=? AND purpose='build' AND status='succeeded' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(revisionId)
    .first<{ facts: string }>();
  return job
    ? (JSON.parse(job.facts) as {
        parts?: { label: string }[];
        steps?: StepLog[];
      })
    : null;
}

/** Applies one change to the latest revision, saves it as a new revision and queues its build. */
async function change(
  c: Context,
  i: { modelId: string; expectedRevision: number; sessionId?: string },
  make: (
    steps: ReturnType<typeof readSteps>["steps"],
    projectId: string,
  ) => StepChange | Promise<StepChange>,
) {
  const model = await modelAccess(c, i.modelId);
  if (
    i.sessionId &&
    (await sessionFor(c, i.sessionId)).project_id !== model.project_id
  )
    throw new AppError(400, "Session belongs to another project");
  if (model.revision !== i.expectedRevision)
    throw new AppError(409, "Model changed. Reload before saving.");
  const revision = await c.env.DB.prepare(
    "SELECT * FROM revisions WHERE model_id=? AND number=?",
  )
    .bind(i.modelId, i.expectedRevision)
    .first<{ id: string; source: string }>();
  if (!revision) throw new AppError(404, "Revision not found");
  const { steps } = readSteps(revision.source);
  const edit = await make(steps, model.project_id);
  const labels =
    (await latestFacts(c, revision.id))?.parts?.map((p) => p.label) ?? [];
  const source = writeSteps(
    revision.source,
    applyStepChange(steps, edit, labels),
  );
  const saved = await saveRevision(c, i.modelId, i.expectedRevision, source, {
    sessionId: i.sessionId,
    request: describeChange(edit),
  });
  const job = await queueBuild(c, saved.id);
  const name = edit.op === "add" ? edit.step.name : edit.name;
  await recordEvent(c, {
    projectId: model.project_id,
    sessionId: i.sessionId ?? null,
    kind: "team_edit",
    payload: {
      message: describeChange(edit),
      modelId: i.modelId,
      revision: saved.number,
      step: name,
    },
  });
  return { revision: saved, job };
}

/** Validates inputs for an action, loading the saved action a custom step names. */
async function checked(
  c: Context,
  projectId: string,
  action: string,
  inputs: Record<string, unknown>,
): Promise<Record<string, StepValue>> {
  const key =
    action === "custom" && typeof inputs.action === "string"
      ? inputs.action
      : null;
  const saved = key ? (await savedAction(c, projectId, key)).record : undefined;
  return validateInputs(getAction(action), inputs, saved);
}

/** Inputs for a new step: a preset's values, overridden by explicit ones, then fully validated. */
async function withPreset(
  c: Context,
  projectId: string,
  action: string,
  inputs: Record<string, unknown>,
  presetId?: string,
) {
  if (!presetId) return checked(c, projectId, action, inputs);
  const preset = await presetFor(c, projectId, presetId);
  const saved = SAVED_KEY.test(preset.action);
  if ((saved ? "custom" : preset.action) !== action)
    throw new AppError(
      400,
      `Preset ${presetId} is for ${preset.action}, not ${action}`,
    );
  const merged = {
    ...preset.inputs,
    ...(saved ? { action: preset.action } : {}),
    ...inputs,
  };
  try {
    return await checked(c, projectId, action, merged);
  } catch (error) {
    if (error instanceof AppError && error.status === 400)
      throw new AppError(400, `Preset ${presetId}: ${error.message}`);
    throw error;
  }
}

function existing(steps: ReturnType<typeof readSteps>["steps"], name: string) {
  const step = steps.find((s) => s.name === name);
  if (!step) throw new AppError(404, `No step named "${name}"`);
  return step;
}

const stepToolList: Tool[] = [
  define(
    "actions_list",
    "List the modeling actions you can add as steps, each with a one-line summary, plus the states a step can be in. Built-in actions come first; with projectId, the saved custom actions (id@version) and presets that project may use follow. Filter by category (Create, Modify, Construct, Combine, Arrange, Custom) or search text. Call actions_describe for an action's inputs before using it.",
    {
      projectId: id.optional(),
      category: z.string().max(40).optional(),
      query: z.string().max(120).optional(),
    },
    true,
    async (c, i) => {
      if (i.projectId) await projectAccess(c, i.projectId, "read");
      const saved = await visibleSaved(c, i.projectId ?? null);
      const presets = await visiblePresets(c, i.projectId ?? null);
      const query = i.query?.toLowerCase();
      const all = [...actions, ...saved.map((s) => s.record)];
      return {
        index: [catalogIndex(), savedIndex(saved, presets)]
          .filter(Boolean)
          .join("\n"),
        actions: all
          .filter((a) => !i.category || a.category === i.category)
          .filter(
            (a) =>
              !query ||
              [a.id, a.title, a.summary, a.description].some((t) =>
                t.toLowerCase().includes(query),
              ),
          )
          .map(({ id, version, title, category, summary }) => ({
            id,
            version,
            title,
            category,
            summary,
          })),
        presets,
        states: stepStates,
      };
    },
  ),
  define(
    "actions_describe",
    "Read one modeling action in full: when to use it, its inputs as a described JSON Schema, which selections it takes, the names it creates, how it can fail and how to fix each failure, an example call, and the presets for it. For a saved action (id@version), pass the projectId it is used in.",
    { id: z.string().max(48), projectId: id.optional() },
    true,
    async (c, i) => {
      if (i.projectId) await projectAccess(c, i.projectId, "read");
      let record;
      if (!SAVED_KEY.test(i.id)) record = getAction(i.id);
      else if (i.projectId)
        record = (await savedAction(c, i.projectId, i.id)).record;
      else {
        record = (await visibleSaved(c, null)).find(
          (s) => s.key === i.id,
        )?.record;
        if (!record) throw new AppError(404, `No saved action ${i.id}`);
      }
      const presets = (await visiblePresets(c, i.projectId ?? null)).filter(
        (p) => p.action === i.id,
      );
      return { ...record, presets };
    },
  ),
  define(
    "steps_list",
    "Read a model's steps in order, from its latest revision, with each step's state from the latest build of that revision. Inputs are included when you may see the model's source.",
    { modelId: id },
    true,
    async (c, i) => {
      const model = await modelAccess(c, i.modelId, "read");
      const revision = await c.env.DB.prepare(
        "SELECT id,source FROM revisions WHERE model_id=? AND number=?",
      )
        .bind(i.modelId, model.revision)
        .first<{ id: string; source: string }>();
      if (!revision) throw new AppError(404, "The model has no revision yet");
      const health = (await latestFacts(c, revision.id))?.steps ?? null;
      const { steps } = readSteps(revision.source);
      return {
        revision: model.revision,
        steps: seesSource(c, model.owner)
          ? steps.map(publicStep)
          : steps.map((s) => ({
              action: s.action,
              name: s.name,
              suppressed: s.suppressed,
            })),
        health,
      };
    },
  ),
  define(
    "steps_add",
    "Add one modeling action as a named step, saved as a new revision and built. Call actions_list for the catalog and actions_describe for the action's inputs. References: {ref:'face',of:'Base',name:'top'}, {ref:'face',of:'Base',normal:[0,0,1],near:[x,y,z]}, {ref:'edges',of:'Base',around:'top'} or between:['top','front'], {ref:'datum',name} for a construction plane's step name or the origin planes XY, XZ and YZ, {ref:'part',label}; a number may be {param:'NAME'} from PARAMS. Inserted after `after` when given, else last. With preset, a saved preset's inputs are filled in first and explicit inputs win.",
    {
      ...target,
      action: z.string().max(40),
      name: stepName,
      inputs,
      after: stepName.optional(),
      preset: z.string().max(40).optional(),
    },
    false,
    async (c, i) =>
      change(c, i, async (_steps, projectId) => ({
        op: "add",
        step: {
          action: i.action,
          name: i.name,
          inputs: await withPreset(c, projectId, i.action, i.inputs, i.preset),
        },
        after: i.after,
      })),
    [...WRITE],
  ),
  define(
    "steps_edit",
    "Replace one step's inputs, keeping its action, name and position. Saves a new revision and builds it.",
    { ...target, name: stepName, inputs },
    false,
    async (c, i) =>
      change(c, i, async (steps, projectId) => ({
        op: "edit",
        name: i.name,
        inputs: await checked(
          c,
          projectId,
          existing(steps, i.name).action,
          i.inputs,
        ),
      })),
    [...WRITE],
  ),
  define(
    "steps_remove",
    "Remove one step. Later steps that refer to what it made fail with a not found error on the next build; remove or edit them too. To keep a step but skip it, use steps_suppress.",
    { ...target, name: stepName },
    false,
    async (c, i) => change(c, i, () => ({ op: "remove", name: i.name })),
    [...WRITE],
  ),
  define(
    "steps_move",
    "Move one step after another step, or to the start with after: null. Steps run in order, so a step must come after the steps it refers to.",
    { ...target, name: stepName, after: stepName.nullable() },
    false,
    async (c, i) =>
      change(c, i, () => ({ op: "move", name: i.name, after: i.after })),
    [...WRITE],
  ),
  define(
    "steps_suppress",
    "Turn a step off (suppressed: true) or back on. A suppressed step stays in the script; steps that depend on it report blocked.",
    { ...target, name: stepName, suppressed: z.boolean() },
    false,
    async (c, i) =>
      change(c, i, () => ({
        op: "suppress",
        name: i.name,
        suppressed: i.suppressed,
      })),
    [...WRITE],
  ),
  define(
    "steps_rename",
    "Rename a step. References to it in later steps are updated.",
    { ...target, name: stepName, newName: stepName },
    false,
    async (c, i) =>
      change(c, i, () => ({ op: "rename", name: i.name, newName: i.newName })),
    [...WRITE],
  ),
];

export const stepTools: Tool[] = stepToolList.map((t) =>
  t.readOnly ? t : { ...t, description: t.description + PLAN_NOTE },
);

export const STEP_WRITES = stepTools
  .filter((t) => !t.readOnly)
  .map((t) => t.name);
