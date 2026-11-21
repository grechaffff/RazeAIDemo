import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ProposeResult } from "../actions/propose";
import type { DB } from "../db/client";
import { LIST_CAMPAIGNS, PROPOSE_ACTION, ProposeToolInput, listCampaignsTool, proposeActionTool } from "../tools";
import { MODEL } from "./client";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** One proposed action from this turn, for the before/after cards in the chat. */
export type AgentAction = Extract<ProposeResult, { ok: true }>;

export type AgentTurn = { reply: string; actions: AgentAction[] };

const MAX_MODEL_CALLS = 6;

const SYSTEM = `You are the Ryze AI marketer for the ad account "Acme Outdoor" (demo data).
Change campaigns only through propose_action. Pass the user's own numbers: a percent goes in change_by_pct, a dollar change in change_by, a target in value. Never do the arithmetic yourself.
Every change is checked against the workspace guardrails on the server. After each result, tell the user in one or two short sentences what happened:
- allow: the change is live; say the new value.
- require_approval: nothing changed yet; it is waiting for approval in the decision log.
- block: nothing changed; name the rule that stopped it, then suggest one alternative that respects the rule.
Never try to get around a rule, for example by cutting a budget to near zero instead of pausing.
Earlier assistant turns may end with a [Server record of this turn] line: that is what the server actually did, so trust it and never "correct" an earlier turn. Answer only the latest request.
If a request is unclear, ask one short question. Reply in the user's language.`;

function jsonSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete json.$schema;
  return json as Anthropic.Tool.InputSchema;
}

const TOOLS: Anthropic.Tool[] = [
  { ...LIST_CAMPAIGNS, input_schema: { type: "object", properties: {} } },
  { ...PROPOSE_ACTION, input_schema: jsonSchema(ProposeToolInput) },
];

/**
 * Runs one chat turn: the model may call tools several times, and every
 * propose_action goes through the same server-side check as MCP.
 */
export async function runAgent(client: Anthropic, db: DB, workspaceId: string, history: ChatMessage[]): Promise<AgentTurn> {
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const actions: AgentAction[] = [];

  for (let call = 0; call < MAX_MODEL_CALLS; call++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      // A copy, so each call records the conversation as it was at that moment.
      messages: [...messages],
    });
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { reply: textOf(response.content), actions };
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      results.push(await runTool(db, workspaceId, use, actions));
    }
    messages.push({ role: "user", content: results });
  }

  return {
    reply: "I stopped after several steps without finishing. Try asking for one change at a time.",
    actions,
  };
}

async function runTool(
  db: DB,
  workspaceId: string,
  use: Anthropic.ToolUseBlock,
  actions: AgentAction[],
): Promise<Anthropic.ToolResultBlockParam> {
  const reply = (content: string, isError = false): Anthropic.ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: use.id,
    content,
    ...(isError ? { is_error: true } : {}),
  });

  if (use.name === LIST_CAMPAIGNS.name) {
    return reply(JSON.stringify(await listCampaignsTool(db, workspaceId)));
  }
  if (use.name === PROPOSE_ACTION.name) {
    const input = ProposeToolInput.safeParse(use.input);
    if (!input.success) return reply(`Invalid input: ${z.prettifyError(input.error)}`, true);
    const { result, text } = await proposeActionTool(db, workspaceId, "chat", input.data);
    if (result.ok) actions.push(result);
    return reply(text, !result.ok);
  }
  return reply(`Unknown tool: ${use.name}`, true);
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
