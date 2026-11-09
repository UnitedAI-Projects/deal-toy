import { AppError, type Context } from "../core";
import { renameIn } from "../actions/ops";
import { readSteps, type StepValue } from "../actions/script";
import { compareSources, layerNames, type SourceChange } from "./ownership";
import {
  declared,
  declaresFramework,
  finishHint,
  otherPlanMessage,
  planState,
  STALE_NOTE,
  type ChangePlan,
  type PlanLayers,
} from "./plans";
import { RESERVED_LAYER, sheetFor, type DesignSheet } from "./sheet";

/**
 * The one check every model write passes through. Agent (MCP) writes must stay inside the model's
 * design sheet and its open change plan; people's writes are never refused and are recorded as
 * finished person changes.
 */
export type GuardResult = {
  changeId: string;
  /**
   * Statements to run in saveRevision's batch, before the revision insert. Each is conditional on
   * the model still being at the expected revision, so a conflicting save leaves no row.
   */
  statements: D1PreparedStatement[];
};

export const LAYOUT =
  "Use the steps layout: import mantel as mt, base() returning None, and one action per line between the mantel:steps markers.";
export const BASE = "base() must return None; put geometry in layers.";

async function previousSource(
  c: Context,
  modelId: string,
  expectedRevision: number,
) {
  if (expectedRevision === 0) return null;
  const row = await c.env.DB.prepare(
    "SELECT source FROM revisions WHERE model_id=? AND number=?",
  )
    .bind(modelId, expectedRevision)
    .first<{ source: string }>();
  return row?.source ?? null;
}

const atRevision = "EXISTS (SELECT 1 FROM models WHERE id=? AND revision=?)";
const now = () => new Date().toISOString();

/** Why the layer names of a framework write are not the framework's, in order, or null. */
function frameworkProblem(names: string[], sheet: DesignSheet): string | null {
  const order = sheet.framework.map((l) => l.name);
  const foreign = names.filter((n) => !order.includes(n));
  if (foreign.length)
    return `${foreign.join(", ")} ${foreign.length > 1 ? "are" : "is"} not in the framework`;
  for (let k = 1; k < names.length; k++)
    if (order.indexOf(names[k]) < order.indexOf(names[k - 1]))
      return `${names[k]} must come before ${names[k - 1]}`;
  return null;
}

/** Layers whose only change is a declared rename rewriting their references. */
function renameOnly(
  before: string | null,
  after: string,
  rename: PlanLayers["rename"],
): Set<string> {
  if (!rename.length || before === null) return new Set();
  const parse = (s: string) => {
    try {
      return readSteps(s).steps;
    } catch {
      return [];
    }
  };
  const after_ = new Map(parse(after).map((s) => [s.name, s]));
  const only = new Set<string>();
  for (const step of parse(before)) {
    const next = after_.get(step.name);
    if (!next) continue;
    let inputs = step.inputs as StepValue;
    for (const r of rename) inputs = renameIn(inputs, r.from, r.to);
    if (
      JSON.stringify(inputs) === JSON.stringify(next.inputs) &&
      step.suppressed === next.suppressed &&
      step.action === next.action
    )
      only.add(step.name);
  }
  return only;
}

function checkAgentWrite(
  plan: ChangePlan,
  sheet: DesignSheet,
  before: string | null,
  source: string,
) {
  const names = layerNames(source);
  if (names?.includes(RESERVED_LAYER))
    throw new AppError(
      400,
      `No layer may be named ${RESERVED_LAYER}; it is reserved for the model's PARAMS.`,
    );
  const allowed = declared(plan.layers);
  const change = compareSources(before, source, allowed);
  if (!sheet.built) {
    if (!change.layout || names === null) throw new AppError(400, LAYOUT);
    if (change.base !== "empty") throw new AppError(400, BASE);
    const problem = frameworkProblem(names, sheet);
    if (problem)
      throw new AppError(
        400,
        `Layers must come from the design sheet's framework, in order: ${problem}.`,
      );
    return;
  }
  if (!change.layout) throw new AppError(400, LAYOUT);
  const exempt = renameOnly(before, source, plan.layers.rename);
  const touched = [
    ...new Set([
      ...change.edited.filter((n) => !exempt.has(n)),
      ...change.added,
      ...change.removed,
      ...change.moved,
    ]),
  ].filter((n) => !allowed.has(n));
  if (touched.length)
    throw new AppError(
      400,
      `This write changes layers the plan does not declare: ${touched.join(", ")}. Start a new plan that includes them.`,
    );
  if (change.params && !declaresFramework(plan.layers))
    throw new AppError(
      400,
      "This write changes PARAMS; declare the Framework layer in the plan's edit list.",
    );
  if (change.shared && !plan.layers.shared)
    throw new AppError(
      400,
      "This write changes shared code (imports, helpers or module constants). Declare shared: true in the plan.",
    );
  // Geometry may not move into base(). A base that already held code (a sheet recorded for an
  // older steps-layout model) is left as it is; changing it counts as shared code above.
  const hadCode =
    before !== null && compareSources(null, before).base === "code";
  if (change.base === "code" && !hadCode) throw new AppError(400, BASE);
}

/** The layers a person's write touched, as a finished plan would list them. */
function personLayers(change: SourceChange): PlanLayers {
  const edit = [
    ...new Set([
      ...change.edited,
      ...change.moved,
      ...(change.params ? [RESERVED_LAYER] : []),
    ]),
  ];
  return {
    add: change.added.map((name) => ({
      name,
      kind: "shape",
      // A person's edit declares no region; presence is only drawn for agent plans.
      region: null,
    })),
    edit,
    remove: change.removed,
    rename: [],
    follow: [],
    shared: change.shared,
  };
}

export async function guardWrite(
  c: Context,
  modelId: string,
  expectedRevision: number,
  source: string,
  sessionId?: string,
  request = "Edited in the interface",
): Promise<GuardResult> {
  const before = await previousSource(c, modelId, expectedRevision);
  if (c.channel === "mcp") {
    const sheet = await sheetFor(c, modelId);
    if (!sheet)
      throw new AppError(
        400,
        "This model has no design sheet. Question the person about every section, then call design_start before saving geometry.",
      );
    const { open, stale } = await planState(c, modelId);
    if (!open)
      throw new AppError(
        409,
        `No change plan is open for this model. Call change_begin with the layers you will add, edit or remove.${stale ? STALE_NOTE : ""}`,
      );
    if (
      open.member !== c.identity.email ||
      (sessionId && open.sessionId && sessionId !== open.sessionId)
    )
      throw new AppError(
        409,
        `Another change plan is open for this model (${otherPlanMessage(open)}).${finishHint(c, open)}`,
      );
    checkAgentWrite(open, sheet, before, source);
    return {
      changeId: open.id,
      statements: [
        c.env.DB.prepare(
          `UPDATE change_plans SET updated_at=? WHERE id=? AND ${atRevision}`,
        ).bind(now(), open.id, modelId, expectedRevision),
      ],
    };
  }
  const model = await c.env.DB.prepare(
    "SELECT project_id FROM models WHERE id=?",
  )
    .bind(modelId)
    .first<{ project_id: string }>();
  if (!model) throw new AppError(404, "Model not found");
  const changeId = crypto.randomUUID();
  const at = now();
  const layers = personLayers(compareSources(before, source));
  return {
    changeId,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO change_plans (id,model_id,project_id,session_id,member,by_kind,framework,request,layers,sections,status,summary,started_at,updated_at,ended_at) SELECT ?,?,?,?,?,'person',0,?,?,'[]','finished',NULL,?,?,? WHERE ${atRevision}`,
      ).bind(
        changeId,
        modelId,
        model.project_id,
        sessionId ?? null,
        c.identity.email,
        request,
        JSON.stringify(layers),
        at,
        at,
        at,
        modelId,
        expectedRevision,
      ),
    ],
  };
}
