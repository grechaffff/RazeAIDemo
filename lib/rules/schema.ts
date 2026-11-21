import { z } from "zod";

/** What the agent can do to a campaign. */
export const ACTION_TYPES = ["budget_change", "bid_change", "pause", "resume"] as const;
export const ActionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/** Actions that change a number; the only ones change limits apply to. */
export const NUMERIC_ACTIONS = ["budget_change", "bid_change"] as const satisfies readonly ActionType[];

export const OutcomeSchema = z.enum(["require_approval", "block"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export type Verdict = "allow" | Outcome;

const ScopeSchema = z.object({
  /** "all" or a list of campaign ids. */
  campaigns: z.union([z.literal("all"), z.array(z.string().min(1)).min(1)]),
  /** "all" or a list of action types. */
  actions: z.union([z.literal("all"), z.array(ActionTypeSchema).min(1)]),
});
export type Scope = z.infer<typeof ScopeSchema>;

const common = {
  scope: ScopeSchema,
  outcome: OutcomeSchema,
  source_text: z.string().min(1),
};

/** "Never touch Brand Search": any matching action on these campaigns. */
const ProtectRuleSchema = z.object({
  type: z.literal("protect"),
  params: z.object({}),
  ...common,
});

/** "Budget changes over $50/day need my approval". */
const MaxChangeAbsRuleSchema = z.object({
  type: z.literal("max_change_abs"),
  params: z.object({
    amount: z.number().positive(),
    /** usd_per_day limits budget changes, usd limits bid changes. */
    unit: z.enum(["usd_per_day", "usd"]),
  }),
  ...common,
});

/** "Never change bids by more than 20%". */
const MaxChangePctRuleSchema = z.object({
  type: z.literal("max_change_pct"),
  params: z.object({ percent: z.number().positive() }),
  ...common,
});

/** "Pausing a campaign always needs approval". */
const ActionPolicyRuleSchema = z.object({
  type: z.literal("action_policy"),
  params: z.object({}),
  ...common,
});

/** A rule as the LLM produces it and the user confirms it. */
export const RuleDefinitionSchema = z.discriminatedUnion("type", [
  ProtectRuleSchema,
  MaxChangeAbsRuleSchema,
  MaxChangePctRuleSchema,
  ActionPolicyRuleSchema,
]);
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;
export type RuleType = RuleDefinition["type"];

/** A stored rule: the definition plus its id, display number and switch. */
export type Rule = RuleDefinition & {
  id: string;
  /** Shown to people as "rule #position". */
  position: number;
  enabled: boolean;
};

/** One change the agent wants to make, with the current value read by the server. */
export type ProposedAction = {
  type: ActionType;
  campaign: { id: string; name: string };
  /** Current and proposed numbers for budget and bid changes; absent for pause and resume. */
  before?: number;
  after?: number;
};
