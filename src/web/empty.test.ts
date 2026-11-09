import { describe, expect, it } from "vitest";
import { agentStart, type ConnectedApp } from "./empty";

const app = (name: string, id = name): ConnectedApp => ({
  id,
  name,
  connected_at: "2026-11-09T17:03:45.000Z",
});

describe("agentStart", () => {
  it("offers to connect when no app is connected", () => {
    expect(agentStart([], "Bridge")).toEqual({
      heading: "Start with your agent",
      body: expect.stringContaining("Connect an MCP client"),
      connectLabel: "Connect an agent",
    });
  });

  it("reads an unknown list the same as an empty one", () => {
    expect(agentStart(null, "Bridge")).toEqual(agentStart([], "Bridge"));
  });

  it("names a single connected app and the project", () => {
    expect(agentStart([app("Claude")], "Bridge")).toEqual({
      heading: "Claude is connected",
      body: "Ask it to build a model in “Bridge”. Its work appears here live.",
      connectLabel: "Add another agent",
    });
  });

  it("names two apps and counts more", () => {
    expect(
      agentStart([app("Claude"), app("Claude Code")], "Bridge").heading,
    ).toBe("Claude and Claude Code are connected");
    expect(
      agentStart([app("Claude"), app("Claude Code"), app("Cursor")], "Bridge")
        .heading,
    ).toBe("3 apps are connected");
  });

  it("counts one app signed in twice once", () => {
    const start = agentStart([app("Claude", "a"), app("Claude", "b")], "B");
    expect(start.heading).toBe("Claude is connected");
    expect(start.body).toMatch(/^Ask it /);
  });
});
