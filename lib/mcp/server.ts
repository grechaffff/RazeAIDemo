import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DB } from "../db/client";
import { LIST_CAMPAIGNS, PROPOSE_ACTION, ProposeToolInput, listCampaignsTool, proposeActionTool } from "../tools";

/**
 * MCP server for one workspace. Same two tools as the web chat agent, same
 * code path: the guardrails are checked here on the server, whatever the
 * client's own approval settings are.
 */
export function buildMcpServer(db: DB, workspaceId: string): McpServer {
  const server = new McpServer(
    { name: "agent-guardrails", version: "0.1.0" },
    {
      instructions:
        "Ads account Acme Outdoor (demo). Change campaigns only with propose_action; every call is checked " +
        "against the workspace guardrails. On a block, tell the user which rule stopped it and do not work around it.",
    },
  );

  server.registerTool(
    LIST_CAMPAIGNS.name,
    {
      description: LIST_CAMPAIGNS.description,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await listCampaignsTool(db, workspaceId)) }],
    }),
  );

  server.registerTool(
    PROPOSE_ACTION.name,
    {
      description: PROPOSE_ACTION.description,
      inputSchema: ProposeToolInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const { result, text } = await proposeActionTool(db, workspaceId, "mcp", input);
      return { content: [{ type: "text", text }], isError: !result.ok };
    },
  );

  return server;
}
