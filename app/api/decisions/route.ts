import { z } from "zod";
import { approveDecision, denyDecision, listDecisions } from "@/lib/actions/propose";
import { getDb } from "@/lib/db/client";
import { getOrCreateWorkspaceId } from "@/lib/workspace";

/** The decision log, newest first. */
export async function GET() {
  const db = getDb();
  const workspaceId = await getOrCreateWorkspaceId(db);
  return Response.json({ decisions: await listDecisions(db, workspaceId) });
}

/** Approve or deny a decision that is waiting for a person. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z.object({ id: z.uuid(), decision: z.enum(["approve", "deny"]) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  const db = getDb();
  const workspaceId = await getOrCreateWorkspaceId(db);
  const { id, decision } = parsed.data;
  const result =
    decision === "approve" ? await approveDecision(db, workspaceId, id) : await denyDecision(db, workspaceId, id);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true });
}
