import { describe, expect, it } from "vitest";
import type { Workspace } from "./api";
import { changedModel, initialModel } from "./follow";

function workspace(
  models: string[],
  revisions: [model: string, number: number, at: string][] = [],
  jobs: [revision: string, updatedAt: string][] = [],
): Workspace {
  return {
    project: {
      id: "p",
      owner: "o@test",
      name: "p",
      brief: "",
      created_at: "2026-10-28T00:00:00.000Z",
      demo: 0,
    },
    models: models.map((id) => ({ id, name: id, revision: 0 })),
    revisions: revisions.map(([model, number, at]) => ({
      id: `${model}-r${number}`,
      model_id: model,
      number,
      created_at: at,
    })),
    jobs: jobs.map(([revision, at], i) => ({
      id: `j${i}`,
      revision_id: revision,
      status: "succeeded",
      facts: null,
      error: null,
      created_at: at,
      updated_at: at,
    })),
    artifacts: [],
    documents: [],
  };
}
const t = (minute: number) =>
  `2026-10-28T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("initialModel", () => {
  it("opens on the model changed most recently", () => {
    const data = workspace(
      ["stand", "wood"],
      [
        ["stand", 1, t(1)],
        ["stand", 2, t(5)],
        ["wood", 1, t(3)],
      ],
      [["wood-r1", t(9)]],
    );
    expect(initialModel(data)).toBe("wood");
  });
  it("falls back to the first model when nothing has been saved", () => {
    expect(initialModel(workspace(["a", "b"]))).toBe("a");
  });
  it("is empty for a project without models", () => {
    expect(initialModel(workspace([]))).toBe("");
  });
});

describe("changedModel", () => {
  const before = workspace(
    ["stand"],
    [["stand", 1, t(1)]],
    [["stand-r1", t(2)]],
  );
  it("names a model that was just created", () => {
    const after = workspace(
      ["stand", "wood"],
      [["stand", 1, t(1)]],
      [["stand-r1", t(2)]],
    );
    expect(changedModel(before, after)).toBe("wood");
  });
  it("names the model that gained a revision", () => {
    const after = workspace(
      ["stand", "wood"],
      [
        ["stand", 1, t(1)],
        ["wood", 1, t(6)],
      ],
      [["stand-r1", t(2)]],
    );
    const withWood = workspace(
      ["stand", "wood"],
      [["stand", 1, t(1)]],
      [["stand-r1", t(2)]],
    );
    expect(changedModel(withWood, after)).toBe("wood");
  });
  it("names the model whose build progressed", () => {
    const two = (buildAt: string) =>
      workspace(
        ["stand", "wood"],
        [
          ["stand", 1, t(1)],
          ["wood", 1, t(3)],
        ],
        [
          ["stand-r1", t(2)],
          ["wood-r1", buildAt],
        ],
      );
    expect(changedModel(two(t(4)), two(t(7)))).toBe("wood");
  });
  it("is undefined when nothing changed", () => {
    expect(changedModel(before, before)).toBeUndefined();
  });
});
