/**
 * Instructions a member pastes into their AI app so it connects itself to Mantel's MCP server.
 * They name each common client's own setup command, because the AI can run those for Claude Code
 * and Codex but must hand the steps back to the member in chat apps it cannot configure.
 */
export function mcpSetupPrompt(origin: string): string {
  const url = `${origin}/mcp`;
  return `Please connect yourself to Mantel, my team's CAD workspace, using MCP.

Server URL: ${url}
Transport: streamable HTTP
Sign-in: OAuth. Mantel has no API keys, so don't ask me for a key or token.

1. Add the server to the app you are running in, named "mantel":
   - Claude Code: run \`claude mcp add --transport http --scope user mantel ${url}\`. Then tell me to run /mcp (restart Claude Code first if mantel isn't listed), choose mantel and sign in.
   - Codex CLI: run \`codex mcp add mantel --url ${url}\`, then \`codex mcp login mantel\`.
   - Cursor, VS Code or another MCP client: add a remote HTTP server named mantel with this URL.
   - Claude on the web or desktop app: you can't add it yourself. Tell me to open Settings → Connectors → Add custom connector, paste the URL and select Connect.
2. A browser page opens. I sign in to Mantel and select Allow. Sign-in finishes by sending the browser back to the computer you run on, so if my browser is on a different computer (for example, you run over SSH), tell me before I sign in.
3. Once connected, call projects_list and tell me how many projects you can see. Before building anything, call skills_list and read the modeling skill.
4. Whenever I ask for a model or a change, send Mantel the start information first:
   - call session_start with my request word for word;
   - for a new model, question me about every section (size, each part's shape, colours, finish, designs), then record my answers and the layers you will build with design_start;
   - for a change, call change_begin with the layers you will add, edit or remove.
   Mantel refuses geometry saves that skip these steps and says what to call next.

You act as me, with my Mantel access level. I can disconnect you at any time in Mantel under Settings → Connected apps.`;
}
