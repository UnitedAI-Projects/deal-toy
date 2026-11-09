import type { Context } from "../core";
import { modelAccess } from "../core";
import { AppError } from "../core";
import { checksLine, evaluateModel } from "../check-tools";
import type { StepLog } from "./catalog";
import { pyValue, readSteps, type Step, type StepValue } from "./script";

/** The compact model summary the agent receives with every MCP result that names a model. */
export const SUMMARY_LIMIT = 1500;

type Facts = {
  parts?: { label: string }[];
  params?: Record<string, { value: number; unit?: string }>;
  steps?: StepLog[];
  incomplete?: boolean;
};
export type SummaryInput = {
  name: string;
  revision: number;
  /** Status of the latest build of this revision, or null when it was never built. */
  status: "queued" | "running" | "succeeded" | "failed" | null;
  /** Facts of that build when it succeeded. */
  facts: Facts | null;
  /** The revision's steps, or null for a free-form script. */
  steps: Step[] | null;
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function stepText(step: Step, i: number, log: Map<string, StepLog>) {
  const head = `${i + 1} ${step.action} "${step.name}"`;
  if (step.suppressed) return { text: `${head} suppressed`, keep: false };
  const entry = log.get(step.name);
  if (!entry || entry.action !== step.action)
    return { text: `${head} pending`, keep: false };
  const detail = entry.message ? ` (${clip(entry.message, 80)})` : "";
  const code = entry.code ? ` ${entry.code}` : "";
  return {
    text: `${head} ${entry.state}${code}${entry.state === "ok" ? "" : detail}`,
    keep: entry.state !== "ok",
  };
}

export function modelSummary(input: SummaryInput): string {
  const facts = input.status === "succeeded" ? input.facts : null;
  const build =
    input.status === "queued" || input.status === "running"
      ? "building"
      : input.status === "failed"
        ? "failed"
        : input.status === null
          ? "not built"
          : facts?.incomplete
            ? "incomplete"
            : "ok";
  const head = `Model "${input.name}" r${input.revision}, build ${build}.`;
  const tail: string[] = [];
  const parts = facts?.parts?.map((p) => p.label).filter(Boolean) ?? [];
  if (parts.length) tail.push(`Parts: ${parts.join(", ")}.`);
  const planes = (input.steps ?? [])
    .filter((s) => s.action === "plane")
    .map((s) => s.name);
  if (planes.length) tail.push(`Planes: ${planes.join(", ")}.`);
  const params = Object.entries(facts?.params ?? {}).map(
    ([name, spec]) =>
      `${name}=${spec.value}${spec.unit ? ` ${spec.unit}` : ""}`,
  );
  if (params.length) tail.push(`Params: ${params.join(", ")}.`);
  let last = clip(tail.join(" "), 600);
  const lines = [head];
  if (input.steps) {
    const log = new Map((facts?.steps ?? []).map((s) => [s.name, s]));
    const items = input.steps.map((s, i) => stepText(s, i, log));
    const render = (dropped: number, shown: typeof items) =>
      `Steps: ${[...(dropped ? [`(+${dropped} earlier ok steps)`] : []), ...shown.map((s) => s.text)].join(" · ")}`;
    let shown = items;
    let dropped = 0;
    const budget = () => SUMMARY_LIMIT - head.length - last.length - 2;
    // Drop the oldest steps that are fine first; failures, warnings and blocks always stay.
    while (render(dropped, shown).length > budget()) {
      const i = shown.findIndex((s) => !s.keep);
      if (i === -1 || i === shown.length - 1) break;
      shown = [...shown.slice(0, i), ...shown.slice(i + 1)];
      dropped++;
    }
    lines.push(clip(render(dropped, shown), Math.max(budget(), 40)));
  }
  if (last) lines.push(last);
  return clip(lines.join("\n"), SUMMARY_LIMIT);
}

/** Loads a model's latest revision and build and summarises them, as the caller may see them. */
export async function modelContext(
  c: Context,
  modelId: string,
): Promise<string> {
  const model = await modelAccess(c, modelId, "read");
  const revision = await c.env.DB.prepare(
    "SELECT id,source FROM revisions WHERE model_id=? AND number=?",
  )
    .bind(modelId, model.revision)
    .first<{ id: string; source: string }>();
  if (!revision) return `Model "${model.name}" has no revision yet.`;
  const job = await c.env.DB.prepare(
    "SELECT status,facts FROM jobs WHERE revision_id=? AND purpose='build' ORDER BY created_at DESC, rowid DESC LIMIT 1",
  )
    .bind(revision.id)
    .first<{ status: SummaryInput["status"]; facts: string | null }>();
  let steps: Step[] | null = null;
  try {
    steps = readSteps(revision.source).steps;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
  }
  const summary = modelSummary({
    name: model.name,
    revision: model.revision,
    status: job?.status ?? null,
    facts: job?.facts ? (JSON.parse(job.facts) as Facts) : null,
    steps,
  });
  // What the project owner has selected in the viewer in the last half hour.
  const selection = await c.env.DB.prepare(
    "SELECT refs FROM selections WHERE model_id=? AND member=? AND updated_at>? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(
      modelId,
      model.owner,
      new Date(Date.now() - 30 * 60_000).toISOString(),
    )
    .first<{ refs: string }>();
  const lines: string[] = [];
  if (selection)
    lines.push(
      `Selected: ${(JSON.parse(selection.refs) as StepValue[]).map(pyValue).join(" · ")}`.slice(
        0,
        400,
      ),
    );
  // Saved checks: how many pass and fail on the latest build, failures named.
  const listed = await c.env.DB.prepare(
    "SELECT 1 FROM check_lists WHERE model_id=?",
  )
    .bind(modelId)
    .first();
  if (listed) {
    const line = checksLine(await evaluateModel(c, modelId));
    if (line) lines.push(line);
  }
  if (!lines.length) return summary;
  const tail = lines.join("\n");
  return `${summary.slice(0, SUMMARY_LIMIT - tail.length - 1)}\n${tail}`;
}
