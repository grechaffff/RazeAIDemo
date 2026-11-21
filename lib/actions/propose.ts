import { and, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { actions, campaigns, decisions } from "../db/schema";
import { evaluate, type RuleMatch } from "../rules/evaluate";
import { loadRules } from "../rules/repo";
import type { ActionType, ProposedAction, Verdict } from "../rules/schema";

export type Channel = "chat" | "mcp" | "api";

export type ProposeInput = {
  workspaceId: string;
  /** Set by the server from the entry point, never by the model. */
  channel: Channel;
  actionType: ActionType;
  /** Campaign id or name; names match case-insensitively, also by a unique prefix. */
  campaign: string;
  /** For budget and bid changes give exactly one of these three. */
  value?: number;
  changeBy?: number;
  changeByPct?: number;
  reason?: string;
};

/** What the action changes: a number for budget and bid, a status for pause and resume. */
export type ActionState = { value: number } | { status: "active" | "paused" };

export type ProposeResult =
  | {
      ok: true;
      actionId: string;
      decisionId: string;
      verdict: Verdict;
      reason: string;
      matches: RuleMatch[];
      /** True when the change is already live (verdict allow). */
      applied: boolean;
      campaign: { id: string; name: string };
      actionType: ActionType;
      before: ActionState;
      after: ActionState;
    }
  | { ok: false; error: string };

type Campaign = typeof campaigns.$inferSelect;
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * The single entry point for every agent write, whatever the channel.
 * Reads the current value from the database, checks the rules, writes the
 * action and the decision to the log, and applies the change only on allow.
 */
export async function proposeAction(db: DB, input: ProposeInput): Promise<ProposeResult> {
  const campaignRows = await db.select().from(campaigns).where(eq(campaigns.workspaceId, input.workspaceId));
  const found = findCampaign(campaignRows, input.campaign);
  if (!found.ok) return found;
  const campaign = found.campaign;

  const change = computeChange(campaign, input);
  if (!change.ok) return change;
  const { before, after } = change;

  const rules = await loadRules(db, input.workspaceId);
  const evaluation = evaluate(toProposed(input.actionType, campaign, before, after), rules);

  return db.transaction(async (tx) => {
    const [action] = await tx
      .insert(actions)
      .values({
        workspaceId: input.workspaceId,
        channel: input.channel,
        actionType: input.actionType,
        campaignId: campaign.id,
        before,
        after,
        reason: input.reason?.trim() ?? "",
      })
      .returning({ id: actions.id });

    const [decision] = await tx
      .insert(decisions)
      .values({
        actionId: action.id,
        verdict: evaluation.verdict,
        matchedRuleIds: evaluation.matches.map((m) => m.ruleId),
        explanation: evaluation.reason,
      })
      .returning({ id: decisions.id });

    const applied = evaluation.verdict === "allow";
    if (applied) await applyChange(tx, campaign.id, input.actionType, after);

    return {
      ok: true as const,
      actionId: action.id,
      decisionId: decision.id,
      verdict: evaluation.verdict,
      reason: evaluation.reason,
      matches: evaluation.matches,
      applied,
      campaign: { id: campaign.id, name: campaign.name },
      actionType: input.actionType,
      before,
      after,
    };
  });
}

/**
 * A person approves a pending action. The rules are checked again first:
 * if a rule added since now blocks it, or the campaign changed under it,
 * nothing is applied and the decision stays pending.
 */
export async function approveDecision(
  db: DB,
  workspaceId: string,
  decisionId: string,
  by = "you",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pending = await loadPending(db, workspaceId, decisionId);
  if (!pending.ok) return pending;
  const { action, campaign } = pending;
  const actionType = action.actionType as ActionType;
  const after = action.after as ActionState;
  const current = currentState(campaign, actionType);

  if (sameState(current, after)) return { ok: false, error: "The campaign already has this value." };
  if (!sameState(current, action.before as ActionState)) {
    return { ok: false, error: "The campaign changed since this was proposed. Deny it and ask the agent again." };
  }

  const recheck = evaluate(toProposed(actionType, campaign, current, after), await loadRules(db, workspaceId));
  if (recheck.verdict === "block") return { ok: false, error: `Now blocked: ${recheck.reason}` };

  return db.transaction(async (tx) => {
    const resolved = await tx
      .update(decisions)
      .set({ resolution: "approved", resolvedBy: by, resolvedAt: new Date() })
      .where(and(eq(decisions.id, decisionId), isNull(decisions.resolution)))
      .returning({ id: decisions.id });
    if (!resolved.length) return { ok: false as const, error: "Already resolved." };
    await applyChange(tx, campaign.id, actionType, after);
    return { ok: true as const };
  });
}

export async function denyDecision(
  db: DB,
  workspaceId: string,
  decisionId: string,
  by = "you",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pending = await loadPending(db, workspaceId, decisionId);
  if (!pending.ok) return pending;
  const resolved = await db
    .update(decisions)
    .set({ resolution: "denied", resolvedBy: by, resolvedAt: new Date() })
    .where(and(eq(decisions.id, decisionId), isNull(decisions.resolution)))
    .returning({ id: decisions.id });
  return resolved.length ? { ok: true } : { ok: false, error: "Already resolved." };
}

/** The decision log, newest first. */
export async function listDecisions(db: DB, workspaceId: string, limit = 50) {
  return db
    .select({
      id: decisions.id,
      verdict: decisions.verdict,
      explanation: decisions.explanation,
      matchedRuleIds: decisions.matchedRuleIds,
      resolution: decisions.resolution,
      resolvedBy: decisions.resolvedBy,
      resolvedAt: decisions.resolvedAt,
      actionId: actions.id,
      channel: actions.channel,
      actionType: actions.actionType,
      before: actions.before,
      after: actions.after,
      reason: actions.reason,
      createdAt: actions.createdAt,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(decisions)
    .innerJoin(actions, eq(decisions.actionId, actions.id))
    .innerJoin(campaigns, eq(actions.campaignId, campaigns.id))
    .where(eq(actions.workspaceId, workspaceId))
    .orderBy(desc(actions.createdAt))
    .limit(limit);
}

// --- helpers -----------------------------------------------------------------

function findCampaign(rows: Campaign[], query: string): { ok: true; campaign: Campaign } | { ok: false; error: string } {
  const q = query.trim().toLowerCase();
  const byId = rows.find((c) => c.id === query.trim());
  if (byId) return { ok: true, campaign: byId };
  const exact = rows.filter((c) => c.name.toLowerCase() === q);
  const candidates = exact.length ? exact : rows.filter((c) => c.name.toLowerCase().startsWith(q));
  if (q && candidates.length === 1) return { ok: true, campaign: candidates[0] };
  const names = rows.map((c) => `"${c.name}"`).join(", ");
  return {
    ok: false,
    error: candidates.length > 1 ? `"${query}" matches several campaigns: ${names}.` : `No campaign "${query}". Campaigns: ${names}.`,
  };
}

function computeChange(
  campaign: Campaign,
  input: ProposeInput,
): { ok: true; before: ActionState; after: ActionState } | { ok: false; error: string } {
  switch (input.actionType) {
    case "pause":
      if (campaign.status === "paused") return { ok: false, error: `${campaign.name} is already paused.` };
      return { ok: true, before: { status: "active" }, after: { status: "paused" } };

    case "resume":
      if (campaign.status === "active") return { ok: false, error: `${campaign.name} is already running.` };
      return { ok: true, before: { status: "paused" }, after: { status: "active" } };

    case "budget_change":
    case "bid_change": {
      const given = [input.value, input.changeBy, input.changeByPct].filter((v) => v !== undefined);
      if (given.length !== 1) return { ok: false, error: "Give exactly one of value, changeBy or changeByPct." };
      if (!given.every((v) => Number.isFinite(v))) return { ok: false, error: "The amount must be a number." };

      const before = input.actionType === "budget_change" ? campaign.dailyBudgetUsd : campaign.bidUsd;
      // The server does the arithmetic, so the model never computes "10% of 1.20" itself.
      const raw =
        input.value !== undefined
          ? input.value
          : input.changeBy !== undefined
            ? before + input.changeBy
            : before * (1 + input.changeByPct! / 100);
      const after = Math.round(raw * 100) / 100;

      if (after <= 0) return { ok: false, error: "The new value must be above zero. To stop spend, pause the campaign." };
      if (after === before) return { ok: false, error: `${campaign.name} already has this value.` };
      return { ok: true, before: { value: before }, after: { value: after } };
    }
  }
}

function toProposed(type: ActionType, campaign: Campaign, before: ActionState, after: ActionState): ProposedAction {
  return {
    type,
    campaign: { id: campaign.id, name: campaign.name },
    before: "value" in before ? before.value : undefined,
    after: "value" in after ? after.value : undefined,
  };
}

function currentState(campaign: Campaign, type: ActionType): ActionState {
  if (type === "budget_change") return { value: campaign.dailyBudgetUsd };
  if (type === "bid_change") return { value: campaign.bidUsd };
  return { status: campaign.status };
}

function sameState(a: ActionState, b: ActionState): boolean {
  if ("value" in a && "value" in b) return a.value === b.value;
  if ("status" in a && "status" in b) return a.status === b.status;
  return false;
}

async function applyChange(tx: Tx, campaignId: string, type: ActionType, after: ActionState) {
  const set =
    type === "budget_change" && "value" in after
      ? { dailyBudgetUsd: after.value }
      : type === "bid_change" && "value" in after
        ? { bidUsd: after.value }
        : "status" in after
          ? { status: after.status }
          : null;
  if (!set) throw new Error(`Cannot apply ${type} with ${JSON.stringify(after)}`);
  await tx.update(campaigns).set(set).where(eq(campaigns.id, campaignId));
}

async function loadPending(db: DB, workspaceId: string, decisionId: string) {
  const rows = await db
    .select({ decision: decisions, action: actions, campaign: campaigns })
    .from(decisions)
    .innerJoin(actions, eq(decisions.actionId, actions.id))
    .innerJoin(campaigns, eq(actions.campaignId, campaigns.id))
    .where(and(eq(decisions.id, decisionId), eq(actions.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false as const, error: "Decision not found." };
  if (row.decision.verdict !== "require_approval") return { ok: false as const, error: "Only pending approvals can be resolved." };
  if (row.decision.resolution) return { ok: false as const, error: "Already resolved." };
  return { ok: true as const, ...row };
}
