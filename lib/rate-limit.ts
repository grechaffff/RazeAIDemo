import { and, count, eq, gt, lt } from "drizzle-orm";
import type { DB } from "./db/client";
import { llmCalls } from "./db/schema";

/** Limits on requests that spend the LLM key. Stored in Postgres so they hold across serverless instances. */
export const LIMITS = {
  perIp: { max: 30, windowMs: 10 * 60 * 1000 },
  global: { max: 1500, windowMs: 24 * 60 * 60 * 1000 },
};

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** Records the call and returns null when it may go ahead, or a message when a limit is hit. */
export async function checkLlmLimit(db: DB, ip: string, route: string, now = new Date()): Promise<string | null> {
  const ipSince = new Date(now.getTime() - LIMITS.perIp.windowMs);
  const daySince = new Date(now.getTime() - LIMITS.global.windowMs);

  const [[byIp], [overall]] = await Promise.all([
    db.select({ n: count() }).from(llmCalls).where(and(eq(llmCalls.ip, ip), gt(llmCalls.createdAt, ipSince))),
    db.select({ n: count() }).from(llmCalls).where(gt(llmCalls.createdAt, daySince)),
  ]);
  if (byIp.n >= LIMITS.perIp.max) return "Too many requests from your address. Please wait a few minutes.";
  if (overall.n >= LIMITS.global.max) return "The demo has reached its daily limit. Please try again tomorrow.";

  await db.insert(llmCalls).values({ ip, route, createdAt: now });
  // Old rows are not needed once they fall out of the longest window.
  await db.delete(llmCalls).where(lt(llmCalls.createdAt, daySince));
  return null;
}
