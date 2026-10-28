import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { AppError, type Context } from "./core";
import { formatNotes } from "./activity";
import { catalog, dispatch, execute, tools } from "./tools";
export async function mcp(request: Request, c: Context) {
  const available = await catalog(c);
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "deal-toy", version: "0.1.0" });
    for (const tool of tools.filter((t) =>
      available.some((a) => a.name === t.name && a.enabled),
    )) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.schema,
          annotations: {
            readOnlyHint: tool.readOnly,
            destructiveHint: false,
            idempotentHint: tool.readOnly,
            openWorldHint: false,
          },
        },
        async (input) => {
          try {
            const { value, notes } = await dispatch(c, tool.name, input, "mcp");
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(value) },
                ...(notes.length
                  ? [{ type: "text" as const, text: formatNotes(notes) }]
                  : []),
              ],
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text:
                    error instanceof AppError
                      ? error.message
                      : "Tool failed; check inputs and retry after reading current state",
                },
              ],
            };
          }
        },
      );
    }
    server.registerResource(
      "workflow-skills",
      "deal-toy://skills",
      {
        description:
          "Versioned workflow guidance. Skills never grant authority.",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await execute(c, "skills_list", {})),
          },
        ],
      }),
    );
    return server;
  });
  return handler.fetch(request);
}
