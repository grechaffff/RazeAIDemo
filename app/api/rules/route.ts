import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { createRule, loadRules, setRuleEnabled } from "@/lib/rules/repo";
import { RuleDefinitionSchema } from "@/lib/rules/schema";
import { getOrCreateWorkspaceId } from "@/lib/workspace";

export async function GET() {
  const db = getDb();
  const workspaceId = await getOrCreateWorkspaceId(db);
  return Response.json({ rules: await loadRules(db, workspaceId) });
}

/** Saves a rule the user has confirmed (the JSON from /api/rules/parse). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z.object({ rule: RuleDefinitionSchema }).safeParse(body);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  const db = getDb();
  const workspaceId = await getOrCreateWorkspaceId(db);
  const result = await createRule(db, workspaceId, parsed.data.rule);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ rule: result.rule }, { status: 201 });
}

/** Turns a rule on or off. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z.object({ id: z.uuid(), enabled: z.boolean() }).safeParse(body);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  const db = getDb();
  const workspaceId = await getOrCreateWorkspaceId(db);
  const rule = await setRuleEnabled(db, workspaceId, parsed.data.id, parsed.data.enabled);
  if (!rule) return Response.json({ error: "Rule not found." }, { status: 404 });
  return Response.json({ rule });
}
