import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { DB } from "./db/client";
import { workspaces } from "./db/schema";
import { createSeededWorkspace } from "./db/seed";

export const WORKSPACE_COOKIE = "ag_ws";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function workspaceExists(db: DB, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return rows.length > 0;
}

/**
 * Returns the visitor's workspace id, creating and seeding a new one when the
 * cookie is missing or points to a workspace that no longer exists.
 * Call only from Route Handlers or Server Functions: it may set a cookie.
 */
export async function getOrCreateWorkspaceId(db: DB): Promise<string> {
  const store = await cookies();
  const current = store.get(WORKSPACE_COOKIE)?.value;
  if (current && (await workspaceExists(db, current))) return current;

  const id = await createSeededWorkspace(db);
  store.set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return id;
}
