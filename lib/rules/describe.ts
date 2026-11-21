import type { ActionType, RuleDefinition } from "./schema";

type CampaignRef = { id: string; name: string };

const NOUN: Record<ActionType, string> = {
  budget_change: "budget changes",
  bid_change: "bid changes",
  pause: "pausing",
  resume: "resuming",
};

/**
 * "How the agent understood your rule", built from the rule JSON itself.
 * The user confirms this sentence, so it must come from the data that will be
 * enforced, not from the model's own summary of it.
 */
export function describeRule(rule: RuleDefinition, campaigns: readonly CampaignRef[]): string {
  const lead = rule.outcome === "block" ? "Blocks" : "Needs your approval for";
  const where =
    rule.scope.campaigns === "all"
      ? "on any campaign"
      : `on ${joinList(rule.scope.campaigns.map((id) => campaigns.find((c) => c.id === id)?.name ?? `unknown campaign ${id}`))}`;
  const listed = rule.scope.actions === "all" ? null : rule.scope.actions;

  switch (rule.type) {
    case "protect":
    case "action_policy": {
      const what = listed ? joinList(listed.map((a) => NOUN[a])) : "every change";
      return `${lead} ${what} ${where}.`;
    }
    case "max_change_abs": {
      const isBudget = rule.params.unit === "usd_per_day";
      const what = isBudget ? "budget changes" : "bid changes";
      const limit = `$${rule.params.amount}${isBudget ? "/day" : ""}`;
      return `${lead} ${what} over ${limit} ${where}.`;
    }
    case "max_change_pct": {
      const numeric = (listed ?? ["budget_change", "bid_change"]).filter((a) => a === "budget_change" || a === "bid_change");
      const what = numeric.length === 1 ? NOUN[numeric[0]] : "budget or bid changes";
      return `${lead} ${what} over ${rule.params.percent}% ${where}.`;
    }
  }
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
