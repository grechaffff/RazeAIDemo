import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { describeRule } from "../rules/describe";
import { parseRule } from "./parse-rule";

const CAMPAIGNS = [
  { id: "c-brand", name: "Brand Search" },
  { id: "c-prosp", name: "Prospecting — Lookalike" },
];

const blank = {
  status: "rule",
  message: "",
  rule_type: null,
  campaign_ids: [],
  actions: [],
  amount_usd: null,
  unit: null,
  percent: null,
  outcome: null,
};

/** A stand-in for the Anthropic client that returns scripted outputs in order. */
function fakeClient(...outputs: Array<Record<string, unknown> | Error>) {
  const parse = vi.fn();
  for (const out of outputs) {
    if (out instanceof Error) parse.mockRejectedValueOnce(out);
    else parse.mockResolvedValueOnce({ parsed_output: { ...blank, ...out } });
  }
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

describe("parseRule", () => {
  it("turns the step 2 rule into a validated rule and a preview sentence", async () => {
    const { client, parse } = fakeClient({
      rule_type: "max_change_pct",
      actions: ["bid_change"],
      percent: 20,
      outcome: "block",
    });
    const r = await parseRule(client, "Never change bids by more than 20%", CAMPAIGNS);
    expect(r).toEqual({
      kind: "rule",
      rule: {
        type: "max_change_pct",
        scope: { campaigns: "all", actions: ["bid_change"] },
        params: { percent: 20 },
        outcome: "block",
        source_text: "Never change bids by more than 20%",
      },
      description: "Blocks bid changes over 20% on any campaign.",
    });

    // The request carries the campaign ids and a JSON schema for structured output.
    const request = parse.mock.calls[0][0];
    expect(request.messages[0].content).toContain("c-brand: Brand Search");
    expect(request.output_config.format.schema).toMatchObject({ type: "object" });
  });

  it("returns the model's clarifying question instead of guessing", async () => {
    const { client } = fakeClient({ status: "question", message: "What daily limit should I use?" });
    expect(await parseRule(client, "don't spend too much", CAMPAIGNS)).toEqual({
      kind: "question",
      question: "What daily limit should I use?",
    });
  });

  it("explains rules the four types cannot express", async () => {
    const { client } = fakeClient({ status: "unsupported", message: "Time-based rules are not supported yet." });
    expect(await parseRule(client, "No changes on weekends", CAMPAIGNS)).toMatchObject({ kind: "question" });
  });

  it("retries once with the problem when the output does not validate", async () => {
    const { client, parse } = fakeClient(
      { rule_type: "max_change_abs", actions: ["budget_change"], amount_usd: null, unit: "usd_per_day", outcome: "require_approval" },
      { rule_type: "max_change_abs", actions: ["budget_change"], amount_usd: 50, unit: "usd_per_day", outcome: "require_approval" },
    );
    const r = await parseRule(client, "Budget changes over $50/day need my approval", CAMPAIGNS);
    expect(r).toMatchObject({ kind: "rule", description: "Needs your approval for budget changes over $50/day on any campaign." });
    expect(parse).toHaveBeenCalledTimes(2);
    const retry = parse.mock.calls[1][0].messages;
    expect(retry.at(-1).content).toContain("The rule is incomplete");
  });

  it("rejects campaign ids the model made up", async () => {
    const { client, parse } = fakeClient(
      { rule_type: "protect", campaign_ids: ["c-fake"], outcome: "block" },
      { rule_type: "protect", campaign_ids: ["c-brand"], outcome: "block" },
    );
    const r = await parseRule(client, "Never touch Brand Search", CAMPAIGNS);
    expect(r).toMatchObject({ kind: "rule", description: "Blocks every change on Brand Search." });
    expect(parse.mock.calls[1][0].messages.at(-1).content).toContain("Unknown campaign ids: c-fake");
  });

  it("gives a clear error after the second bad output", async () => {
    const { client, parse } = fakeClient(new Error("bad json"), new Error("bad json again"));
    const r = await parseRule(client, "Never touch Brand Search", CAMPAIGNS);
    expect(r).toMatchObject({ kind: "error" });
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

describe("describeRule", () => {
  it("describes each starting rule in one sentence", () => {
    expect(
      describeRule(
        {
          type: "action_policy",
          scope: { campaigns: "all", actions: ["pause"] },
          params: {},
          outcome: "require_approval",
          source_text: "Pausing a campaign always needs approval",
        },
        CAMPAIGNS,
      ),
    ).toBe("Needs your approval for pausing on any campaign.");
    expect(
      describeRule(
        {
          type: "protect",
          scope: { campaigns: ["c-brand", "c-prosp"], actions: ["pause", "budget_change"] },
          params: {},
          outcome: "block",
          source_text: "x",
        },
        CAMPAIGNS,
      ),
    ).toBe("Blocks pausing and budget changes on Brand Search and Prospecting — Lookalike.");
  });
});
