import { getDb } from "@/lib/db/client";
import { resetWorkspace } from "@/lib/db/seed";
import { getOrCreateWorkspaceId } from "@/lib/workspace";

export async function POST() {
  const db = getDb();
  const workspaceId = await getOrCreateWorkspaceId(db);
  await resetWorkspace(db, workspaceId);
  return Response.json({ ok: true, workspaceId });
}
