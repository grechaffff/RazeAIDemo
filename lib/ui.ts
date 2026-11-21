/** Shapes the page receives from the API, and small display helpers. Safe for client code. */
import type { ActionState } from "./actions/propose";
import type { ActionType, Verdict } from "./rules/schema";

export type CampaignView = {
  id: string;
  name: string;
  platform: "google" | "meta";
  dailyBudgetUsd: number;
  bidUsd: number;
  status: "active" | "paused";
};

export type RuleView = {
  id: string;
  position: number;
  sourceText: string;
  type: string;
  scope: unknown;
  params: unknown;
  outcome: "require_approval" | "block";
  enabled: boolean;
};

export type WorkspaceView = {
  workspaceId: string;
  name: string;
  mcpPath: string;
  campaigns: CampaignView[];
  rules: RuleView[];
};

export type DecisionView = {
  id: string;
  verdict: Verdict;
  explanation: string;
  matchedRuleIds: string[];
  resolution: "approved" | "denied" | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  channel: "chat" | "mcp" | "api";
  actionType: ActionType;
  before: ActionState;
  after: ActionState;
  reason: string;
  createdAt: string;
  campaignName: string;
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  allow: "Applied",
  require_approval: "Needs approval",
  block: "Blocked",
};

export const VERDICT_STYLE: Record<Verdict, { text: string; bg: string; dot: string; border: string }> = {
  allow: { text: "text-allow", bg: "bg-allow-bg", dot: "bg-allow", border: "border-allow/40" },
  require_approval: { text: "text-approval", bg: "bg-approval-bg", dot: "bg-approval", border: "border-approval/40" },
  block: { text: "text-block", bg: "bg-block-bg", dot: "bg-block", border: "border-block/40" },
};

export const ACTION_LABEL: Record<ActionType, string> = {
  budget_change: "Budget",
  bid_change: "Bid",
  pause: "Pause",
  resume: "Resume",
};

export const CHANNEL_LABEL = { chat: "Chat", mcp: "MCP", api: "API" } as const;

export function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "$200/day", "$1.20" or "Active", depending on what the action changes. */
export function formatState(type: ActionType, state: ActionState): string {
  if ("status" in state) return state.status === "active" ? "Active" : "Paused";
  return type === "budget_change" ? `${money(state.value)}/day` : money(state.value);
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
