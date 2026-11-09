import { describe, expect, it } from "vitest";
import { mcpSetupPrompt } from "./setup";

describe("mcpSetupPrompt", () => {
  const prompt = mcpSetupPrompt("https://mantel.example");

  it("points every client at this site's MCP URL", () => {
    expect(prompt).toContain("Server URL: https://mantel.example/mcp");
    expect(prompt).toContain(
      "claude mcp add --transport http --scope user mantel https://mantel.example/mcp",
    );
    expect(prompt).toContain(
      "codex mcp add mantel --url https://mantel.example/mcp",
    );
    expect(prompt).toContain("codex mcp login mantel");
  });

  it("says sign-in is OAuth so the AI never asks for a key", () => {
    expect(prompt).toContain("Mantel has no API keys");
    expect(prompt).not.toMatch(/mtl_|Bearer/);
  });

  it("asks the AI to prove the connection works", () => {
    expect(prompt).toContain("projects_list");
    expect(prompt).toContain("skills_list");
  });
});
