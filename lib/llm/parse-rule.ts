import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { describeRule } from "../rules/describe";
import { ACTION_TYPES, RuleDefinitionSchema, type RuleDefinition } from "../rules/schema";
import { MODEL } from "./client";

type CampaignRef = { id: string; name: string };

export type ParseRuleResult =
  | { kind: "rule"; rule: RuleDefinition; description: string }
  | { kind: "question"; question: string }
  | { kind: "error"; error: string };

/**
 * What the model fills in. Deliberately flat with nullable fields: easy for
 * structured output, and our own code turns it into a RuleDefinition and
 * validates it with the real schema.
 */
const ModelOutput = z.object({
  status: z.enum(["rule", "question", "unsupported"]),
  message: z
    .string()
    .describe('For "question": the one short clarifying question. For "unsupported": one sentence on why. Empty for "rule".'),
  rule_type: z.enum(["protect", "max_change_abs", "max_change_pct", "action_policy"]).nullable(),
  campaign_ids: z.array(z.string()).describe("Ids from the campaign list. Empty array means all campaigns."),
  actions: z.array(z.enum(ACTION_TYPES)).describe("Empty array means every action."),
  amount_usd: z.number().nullable().describe("max_change_abs only: the dollar limit."),
  unit: z.enum(["usd_per_day", "usd"]).nullable().describe("max_change_abs only: usd_per_day for budgets, usd for bids."),
  percent: z.number().nullable().describe("max_change_pct only: the percent limit, e.g. 20."),
  outcome: z.enum(["require_approval", "block"]).nullable(),
});
type ModelOutput = z.infer<typeof ModelOutput>;

const SYSTEM = `You turn one plain-English guardrail for an ads agent into structured data. You never decide whether any action is allowed; code does that.

Rule types:
- protect: the listed campaigns must not be touched by the listed actions. "Never touch Brand Search" = protect, that campaign, every action, block.
- max_change_abs: a change bigger than a dollar amount fires. Budgets use unit usd_per_day, bids use unit usd. "Budget changes over $50/day need my approval" = max_change_abs, actions [budget_change], 50, usd_per_day, require_approval.
- max_change_pct: a change bigger than a percent fires. "Never change bids by more than 20%" = max_change_pct, actions [bid_change], 20, block.
- action_policy: an action type always fires. "Pausing a campaign always needs approval" = action_policy, actions [pause], require_approval.

Outcome: "never", "don't", "must not" mean block. "needs my approval", "ask me", "check with me" mean require_approval.
Actions: budget_change, bid_change, pause, resume. Empty list means every action. Empty campaign list means all campaigns.

If the rule is vague (no limit, "don't spend too much"), names a campaign that is not in the list, or could mean two different rules, set status "question" and ask ONE short question. Do not guess.
If it needs something these four types cannot express (time of day, weekends, total account spend, roles, people), set status "unsupported" and say so in one sentence.`;

/**
 * Text → validated rule, a clarifying question, or a clear error.
 * One retry when the output does not validate.
 */
export async function parseRule(client: Anthropic, text: string, campaigns: readonly CampaignRef[]): Promise<ParseRuleResult> {
  const prompt = `Campaigns (id: name):\n${campaigns.map((c) => `${c.id}: ${c.name}`).join("\n")}\n\nRule: ${text.trim()}`;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let output: ModelOutput | null = null;
    let problem: string;
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages,
        output_config: { format: zodOutputFormat(ModelOutput) },
      });
      output = response.parsed_output ?? null;
      problem = output ? "" : "The output was empty.";
    } catch (err) {
      if (isApiError(err)) return { kind: "error", error: `Claude API error: ${err.message}` };
      problem = `The output was not valid JSON for the schema: ${(err as Error).message}`;
    }

    if (output) {
      const result = toResult(output, text, campaigns);
      if (result.ok) return result.value;
      problem = result.problem;
      messages.push({ role: "assistant", content: JSON.stringify(output) });
    }

    messages.push({ role: "user", content: `${problem} Return a corrected answer for the same rule.` });
  }

  return {
    kind: "error",
    error: 'Could not turn this into a rule. Try naming the campaign and the limit, e.g. "Budget changes over $50/day need my approval".',
  };
}

function toResult(
  out: ModelOutput,
  text: string,
  campaigns: readonly CampaignRef[],
): { ok: true; value: ParseRuleResult } | { ok: false; problem: string } {
  if (out.status === "question" || out.status === "unsupported") {
    const message = out.message.trim();
    if (!message) return { ok: false, problem: `Status "${out.status}" needs a message.` };
    return { ok: true, value: { kind: "question", question: message } };
  }

  const unknown = out.campaign_ids.filter((id) => !campaigns.some((c) => c.id === id));
  if (unknown.length) return { ok: false, problem: `Unknown campaign ids: ${unknown.join(", ")}. Use ids from the list.` };

  const common = {
    scope: {
      campaigns: out.campaign_ids.length ? out.campaign_ids : ("all" as const),
      actions: out.actions.length ? out.actions : ("all" as const),
    },
    outcome: out.outcome,
    source_text: text.trim(),
  };
  const candidate =
    out.rule_type === "max_change_abs"
      ? { ...common, type: out.rule_type, params: { amount: out.amount_usd, unit: out.unit } }
      : out.rule_type === "max_change_pct"
        ? { ...common, type: out.rule_type, params: { percent: out.percent } }
        : { ...common, type: out.rule_type, params: {} };

  const parsed = RuleDefinitionSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, problem: `The rule is incomplete: ${z.prettifyError(parsed.error)}` };
  return { ok: true, value: { kind: "rule", rule: parsed.data, description: describeRule(parsed.data, campaigns) } };
}

/** Network, auth and rate-limit failures: retrying with a correction will not help. */
function isApiError(err: unknown): err is Error {
  return err instanceof Anthropic.APIError;
}
