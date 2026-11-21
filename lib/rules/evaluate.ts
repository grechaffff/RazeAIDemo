import {
  NUMERIC_ACTIONS,
  type ActionType,
  type Outcome,
  type ProposedAction,
  type Rule,
  type Verdict,
} from "./schema";

export type RuleMatch = {
  ruleId: string;
  position: number;
  type: Rule["type"];
  outcome: Outcome;
  reason: string;
};

export type Evaluation = {
  verdict: Verdict;
  /** Every enabled rule that fired, strictest first, then by rule number. */
  matches: RuleMatch[];
  /** One human-readable sentence or two: why this verdict. */
  reason: string;
};

const STRICTNESS: Record<Verdict, number> = { allow: 0, require_approval: 1, block: 2 };

/**
 * Checks one proposed action against the workspace rules.
 * Pure: no I/O, no clock, no LLM. The strictest matching outcome wins;
 * when nothing matches the action is allowed.
 */
export function evaluate(action: ProposedAction, rules: readonly Rule[]): Evaluation {
  const matches: RuleMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled || !inScope(rule, action)) continue;
    const reason = check(rule, action);
    if (reason) {
      matches.push({ ruleId: rule.id, position: rule.position, type: rule.type, outcome: rule.outcome, reason });
    }
  }

  matches.sort((a, b) => STRICTNESS[b.outcome] - STRICTNESS[a.outcome] || a.position - b.position);
  const verdict: Verdict = matches[0]?.outcome ?? "allow";
  return { verdict, matches, reason: explain(verdict, matches) };
}

function inScope(rule: Rule, action: ProposedAction): boolean {
  const { campaigns, actions } = rule.scope;
  const campaignOk = campaigns === "all" || campaigns.includes(action.campaign.id);
  const actionOk = actions === "all" || actions.includes(action.type);
  return campaignOk && actionOk;
}

/** Returns why the rule fires, or null when it does not. */
function check(rule: Rule, action: ProposedAction): string | null {
  const cite = `rule #${rule.position}: "${rule.source_text}"`;

  switch (rule.type) {
    case "protect":
      return `${action.campaign.name} is protected by ${cite}.`;

    case "action_policy":
      return `${VERB[action.type]} is covered by ${cite}.`;

    case "max_change_abs": {
      const change = numericChange(action);
      if (!change) return null;
      const unitFor: Record<string, string> = { budget_change: "usd_per_day", bid_change: "usd" };
      if (unitFor[action.type] !== rule.params.unit) return null;
      if (change.abs <= rule.params.amount) return null;
      const suffix = rule.params.unit === "usd_per_day" ? "/day" : "";
      return `A ${money(change.abs)}${suffix} change is over the ${money(rule.params.amount)}${suffix} limit in ${cite}.`;
    }

    case "max_change_pct": {
      const change = numericChange(action);
      if (!change) return null;
      if (change.pct <= rule.params.percent) return null;
      const shown = Number.isFinite(change.pct) ? `${round(change.pct, 1)}%` : "a change from zero";
      return `A ${shown} change is over the ${rule.params.percent}% limit in ${cite}.`;
    }
  }
}

function numericChange(action: ProposedAction): { abs: number; pct: number } | null {
  if (!(NUMERIC_ACTIONS as readonly ActionType[]).includes(action.type)) return null;
  if (action.before === undefined || action.after === undefined) return null;
  // Work in cents so 0.1 + 0.2 style float noise never trips a limit.
  const abs = Math.abs(Math.round(action.after * 100) - Math.round(action.before * 100)) / 100;
  if (abs === 0) return { abs: 0, pct: 0 };
  const pct = action.before === 0 ? Infinity : round((abs / Math.abs(action.before)) * 100, 4);
  return { abs, pct };
}

function explain(verdict: Verdict, matches: RuleMatch[]): string {
  if (matches.length === 0) return "No rules matched.";
  const decisive = matches.filter((m) => m.outcome === verdict).map((m) => m.reason);
  const others = matches.filter((m) => m.outcome !== verdict).map((m) => `#${m.position}`);
  const also = others.length ? ` Also matched ${others.join(", ")}; the stricter rule wins.` : "";
  return decisive.join(" ") + also;
}

const VERB: Record<ActionType, string> = {
  budget_change: "Changing the budget",
  bid_change: "Changing bids",
  pause: "Pausing",
  resume: "Resuming",
};

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
