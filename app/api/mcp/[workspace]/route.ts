import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/lib/db/client";
import { buildMcpServer } from "@/lib/mcp/server";
import { workspaceExists } from "@/lib/workspace";

/**
 * Streamable HTTP MCP endpoint, one per workspace: /api/mcp/<workspace id>.
 * Stateless: every request gets a fresh server and transport, which suits
 * serverless hosting. The workspace id in the URL is the only credential,
 * as in a demo; a real product would use OAuth here.
 */
async function handle(request: Request, ctx: RouteContext<"/api/mcp/[workspace]">): Promise<Response> {
  const { workspace } = await ctx.params;
  const db = getDb();
  if (!(await workspaceExists(db, workspace))) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unknown workspace. Copy the MCP URL from the demo page." }, id: null },
      { status: 404 },
    );
  }

  const server = buildMcpServer(db, workspace);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // With JSON responses the reply is complete here, so the per-request server can go.
    await server.close();
  }
}

export { handle as POST };

/** No sessions and no server-sent stream: stateless servers answer GET and DELETE with 405. */
function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export { methodNotAllowed as GET, methodNotAllowed as DELETE };
