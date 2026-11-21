import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { campaigns, rules } from "@/lib/db/schema";
import { getOrCreateWorkspaceId } from "@/lib/workspace";

/** Everything the page needs on load: campaigns, rules and the MCP path. */
export async function GET() {
  const db = getDb();
  const workspaceId = await getOrCreateWorkspaceId(db);
  const [campaignRows, ruleRows] = await Promise.all([
    db.select().from(campaigns).where(eq(campaigns.workspaceId, workspaceId)).orderBy(asc(campaigns.name)),
    db.select().from(rules).where(eq(rules.workspaceId, workspaceId)).orderBy(asc(rules.position)),
  ]);
  return Response.json({
    workspaceId,
    name: "Acme Outdoor",
    mcpPath: `/api/mcp/${workspaceId}`,
    campaigns: campaignRows,
    rules: ruleRows,
  });
}
