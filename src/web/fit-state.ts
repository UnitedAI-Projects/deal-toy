/**
 * The workspace's fit view: how far the model is exploded, which joints are posed away from the
 * build, and a part drag in flight. Pure, so a release commits exactly once; nothing here is saved.
 */
import type {
  DimensionRecord,
  InspectRecord,
  JointRecord,
} from "../shared/inspect-types";

export type FitState = {
  buildId: string | null;
  explode: number;
  /** Joint index → the value it is shown at, when that differs from the build. */
  poses: Record<number, number>;
  drag: { joint: number; start: number; before?: number } | null;
  /** The joint last moved, for the label. */
  last: number | null;
  /** A release committed and the rebuild has not arrived yet. */
  previewing: boolean;
  /** A release that could not commit left this pose for viewing only. */
  viewOnly: boolean;
};
export type FitAction =
  | { type: "explode"; amount: number }
  | { type: "collapse" }
  | { type: "start"; joint: number; value: number }
  | { type: "move"; value: number }
  | { type: "cancel" }
  | { type: "release"; commits: boolean }
  | { type: "reset" }
  | { type: "record"; buildId: string | null };

export function initialFit(buildId: string | null): FitState {
  return {
    buildId,
    explode: 0,
    poses: {},
    drag: null,
    last: null,
    previewing: false,
    viewOnly: false,
  };
}

function without(poses: Record<number, number>, joint: number) {
  const { [joint]: _, ...rest } = poses;
  return rest;
}

export function fitStep(
  state: FitState,
  action: FitAction,
): { state: FitState; commit?: { joint: number; value: number } } {
  switch (action.type) {
    case "explode": {
      const a = Number.isFinite(action.amount) ? action.amount : 0;
      return { state: { ...state, explode: Math.min(1, Math.max(0, a)) } };
    }
    case "collapse":
      return { state: { ...state, explode: 0 } };
    case "start":
      if (state.drag) return { state };
      return {
        state: {
          ...state,
          drag: {
            joint: action.joint,
            start: action.value,
            before: state.poses[action.joint],
          },
          last: action.joint,
          viewOnly: false,
        },
      };
    case "move":
      if (!state.drag || !Number.isFinite(action.value)) return { state };
      return {
        state: {
          ...state,
          poses: { ...state.poses, [state.drag.joint]: action.value },
        },
      };
    case "cancel": {
      if (!state.drag) return { state };
      const { joint, before } = state.drag;
      return {
        state: {
          ...state,
          drag: null,
          poses:
            before === undefined
              ? without(state.poses, joint)
              : { ...state.poses, [joint]: before },
        },
      };
    }
    case "release": {
      if (!state.drag) return { state };
      const { joint, start } = state.drag;
      const value = state.poses[joint];
      if (value === undefined || value === start) {
        const unchanged = cancelled(state);
        return { state: unchanged };
      }
      if (action.commits)
        return {
          state: { ...state, drag: null, previewing: true, viewOnly: false },
          commit: { joint, value },
        };
      return { state: { ...state, drag: null, viewOnly: true } };
    }
    case "reset":
      return {
        state: {
          ...state,
          poses: {},
          drag: null,
          previewing: false,
          viewOnly: false,
        },
      };
    case "record":
      if (action.buildId === state.buildId) return { state };
      return {
        state: {
          ...initialFit(action.buildId),
          explode: state.explode,
        },
      };
  }
}

function cancelled(state: FitState): FitState {
  return fitStep(state, { type: "cancel" }).state;
}

/** The placement a release of this joint commits through, or null when it may not commit. */
export function commitsFor(
  record: InspectRecord,
  joint: number,
  canEdit: boolean,
): DimensionRecord | null {
  if (!canEdit) return null;
  const dim = record.dimensions?.find((d) => d.joint === joint);
  return dim && dim.param && dim.matches_param ? dim : null;
}

const valueText = (joint: JointRecord, v: number) =>
  joint.unit === "deg" ? `${v.toFixed(1)}°` : `${v.toFixed(2)} mm`;

function jointName(record: InspectRecord, k: number) {
  const joint = record.joints![k];
  return (
    record.dimensions?.find((d) => d.joint === k)?.name ??
    `${record.parts[joint.part]?.label ?? "Part"} on "${joint.name}"`
  );
}

/** What the drag label says: the value, and whether it is a preview or only a view. */
export function fitLabel(
  record: InspectRecord,
  state: FitState,
): string | null {
  const k = state.drag?.joint ?? state.last;
  if (k === null || !record.joints?.[k]) return null;
  const value = state.poses[k];
  if (value === undefined) return null;
  const head = `${jointName(record, k)} ${valueText(record.joints[k], value)}`;
  if (state.drag || state.previewing) return `${head} · Preview`;
  if (state.viewOnly) return `${head} · View only: not saved`;
  return null;
}

/** How a part attaches, for its popover; null when the model declares no joints. */
export function attachmentText(
  record: InspectRecord,
  label: string,
): string | null {
  if (!record.joints?.length) return null;
  const index = record.parts.findIndex((p) => p.label === label);
  const joint = record.joints.find((j) => j.part === index);
  if (!joint) return "Not attached by a joint";
  const to = record.parts[joint.to]?.label ?? "another part";
  if (joint.kind === "rigid") return `Fixed to ${to} by "${joint.name}"`;
  const [low, high] = joint.range;
  const range =
    high === null
      ? `from ${valueText(joint, low)}`
      : joint.unit === "deg"
        ? `${low.toFixed(1)}–${high.toFixed(1)}°`
        : `${low.toFixed(2)}–${high.toFixed(2)} mm`;
  const text = `Attached to ${to} by "${joint.name}" (${joint.kind}) · ${valueText(joint, joint.value)} (${range})`;
  const k = record.joints.indexOf(joint);
  const stale = record.dimensions?.find(
    (d) => d.joint === k && d.param && !d.matches_param,
  );
  return stale
    ? `${text}. ${stale.name} doesn't match ${stale.param}, so dragging is view only; ask the agent to fix it`
    : text;
}
