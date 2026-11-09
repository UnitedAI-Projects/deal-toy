/** An app the member approved through MCP sign-in, as Settings lists it. */
export type ConnectedApp = { id: string; name: string; connected_at: string };

/** What the empty-project screen says, given the member's connected apps. */
export type AgentStart = {
  heading: string;
  body: string;
  connectLabel: string;
};

/**
 * The empty-project screen's wording. `apps` is null while unknown (still loading, or the request
 * failed); that reads the same as having none, so the screen always offers a way to connect.
 */
export function agentStart(
  apps: ConnectedApp[] | null,
  projectName: string,
): AgentStart {
  if (!apps?.length)
    return {
      heading: "Start with your agent",
      body: "Connect an MCP client to this workspace and prompt it with the project. Its work appears here live.",
      connectLabel: "Connect an agent",
    };
  const names = [...new Set(apps.map((app) => app.name))];
  const who =
    names.length === 1
      ? `${names[0]} is`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are`
        : `${names.length} apps are`;
  const it = names.length === 1 ? "it" : "one";
  return {
    heading: `${who} connected`,
    body: `Ask ${it} to build a model in “${projectName}”. Its work appears here live.`,
    connectLabel: "Add another agent",
  };
}
