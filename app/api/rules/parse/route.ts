import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { campaigns } from "@/lib/db/schema";
import { getAnthropic, LlmNotConfiguredError } from "@/lib/llm/client";
import { parseRule } from "@/lib/llm/parse-rule";
import { checkLlmLimit, clientIp } from "@/lib/rate-limit";
import { getOrCreateWorkspaceId } from "@/lib/workspace";

/** Plain-English rule → a preview to confirm. Nothing is saved here. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z.object({ text: z.string().trim().min(3).max(300) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: "Write the rule in 3 to 300 characters." }, { status: 400 });

  const db = getDb();
  const limited = await checkLlmLimit(db, clientIp(request), "rules/parse");
  if (limited) return Response.json({ kind: "error", error: limited }, { status: 429 });
  const workspaceId = await getOrCreateWorkspaceId(db);
  const list = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.workspaceId, workspaceId));

  try {
    const result = await parseRule(getAnthropic(), parsed.data.text, list);
    return Response.json(result, { status: result.kind === "error" ? 422 : 200 });
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) return Response.json({ kind: "error", error: err.message }, { status: 503 });
    throw err;
  }
}
