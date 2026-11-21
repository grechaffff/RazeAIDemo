import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { proposeAction, type Channel, type ProposeResult } from "./actions/propose";
import type { DB } from "./db/client";
import { campaigns } from "./db/schema";
import { ACTION_TYPES } from "./rules/schema";

/**
 * The two tools an agent gets, shared by the web chat agent and the MCP
 * server so both channels run exactly the same code.
 */

export const LIST_CAMPAIGNS = {
  name: "list_campaigns",
  description: "List the campaigns in this ad account with their daily budget, bid and status. Read-only.",
} as const;

export const PROPOSE_ACTION = {
  name: "propose_action",
  description:
    "Change one campaign: budget_change, bid_change, pause or resume. Every call is checked on the server " +
    "against the workspace guardrails before anything changes. The result has a verdict: allow (applied), " +
    "require_approval (nothing changed yet, waiting for a person) or block (nothing changed). " +
    "For budget and bid changes pass exactly one of value, change_by or change_by_pct, using the user's own numbers; " +
    "the server does the arithmetic.",
} as const;

export const ProposeToolInput = z.object({
  action: z.enum(ACTION_TYPES),
  campaign: z.string().min(1).describe("Campaign name as shown by list_campaigns."),
  value: z.number().optional().describe("New absolute value in USD: daily budget or bid."),
  change_by: z.number().optional().describe("Signed change in USD, e.g. 80 or -20."),
  change_by_pct: z.number().optional().describe("Signed change in percent, e.g. -10."),
  reason: z.string().describe("Why, in a few words."),
});
export type ProposeToolInput = z.infer<typeof ProposeToolInput>;

export async function listCampaignsTool(db: DB, workspaceId: string) {
  const rows = await db.select().from(campaigns).where(eq(campaigns.workspaceId, workspaceId)).orderBy(asc(campaigns.name));
  return {
    campaigns: rows.map((c) => ({
      name: c.name,
      platform: c.platform,
      daily_budget_usd: c.dailyBudgetUsd,
      bid_usd: c.bidUsd,
      status: c.status,
    })),
  };
}

const NEXT_STEP = {
  allow: "Done: the change is live.",
  require_approval: "Nothing changed yet. The request is waiting for a person in the decision log.",
  block:
    "Nothing changed. Tell the user which rule stopped it. Do not try to reach the same result another way; " +
    "the rule owner can change the rule if they want this.",
} as const;

/** Runs propose_action for any channel and returns both the result and the text a model should read. */
export async function proposeActionTool(
  db: DB,
  workspaceId: string,
  channel: Channel,
  input: ProposeToolInput,
): Promise<{ result: ProposeResult; text: string }> {
  const result = await proposeAction(db, {
    workspaceId,
    channel,
    actionType: input.action,
    campaign: input.campaign,
    value: input.value,
    changeBy: input.change_by,
    changeByPct: input.change_by_pct,
    reason: input.reason,
  });
  if (!result.ok) return { result, text: `Error: ${result.error}` };

  const text = JSON.stringify({
    verdict: result.verdict,
    applied: result.applied,
    reason: result.reason,
    campaign: result.campaign.name,
    action: result.actionType,
    before: result.before,
    after: result.after,
    next_step: NEXT_STEP[result.verdict],
  });
  return { result, text };
}
