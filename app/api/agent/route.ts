import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { runAgent } from "@/lib/llm/agent";
import { getAnthropic, LlmNotConfiguredError } from "@/lib/llm/client";
import { checkLlmLimit, clientIp } from "@/lib/rate-limit";
import { getOrCreateWorkspaceId } from "@/lib/workspace";

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(30)
    .refine((m) => m.at(-1)?.role === "user", "The last message must be from the user."),
});

/** One web chat turn. The channel is "chat" because the request came in here. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  const db = getDb();
  const limited = await checkLlmLimit(db, clientIp(request), "agent");
  if (limited) return Response.json({ kind: "error", error: limited }, { status: 429 });
  const workspaceId = await getOrCreateWorkspaceId(db);
  try {
    return Response.json(await runAgent(getAnthropic(), db, workspaceId, parsed.data.messages));
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) return Response.json({ error: err.message }, { status: 503 });
    throw err;
  }
}
