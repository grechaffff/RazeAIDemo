import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate";
import { RuleDefinitionSchema, type ProposedAction, type Rule } from "./schema";

const BRAND = { id: "c-brand", name: "Brand Search" };
const PROSPECTING = { id: "c-prosp", name: "Prospecting — Lookalike" };
const RETARGETING = { id: "c-retarg", name: "Retargeting" };

// The three starting rules from SPEC.md, in display order.
const protectBrand: Rule = {
  id: "r1",
  position: 1,
  enabled: true,
  type: "protect",
  scope: { campaigns: [BRAND.id], actions: "all" },
  params: {},
  outcome: "block",
  source_text: "Never touch Brand Search",
};
const budgetOver50: Rule = {
  id: "r2",
  position: 2,
  enabled: true,
  type: "max_change_abs",
  scope: { campaigns: "all", actions: ["budget_change"] },
  params: { amount: 50, unit: "usd_per_day" },
  outcome: "require_approval",
  source_text: "Budget changes over $50/day need my approval",
};
const pauseNeedsApproval: Rule = {
  id: "r3",
  position: 3,
  enabled: true,
  type: "action_policy",
  scope: { campaigns: "all", actions: ["pause"] },
  params: {},
  outcome: "require_approval",
  source_text: "Pausing a campaign always needs approval",
};
const bidsOver20Pct: Rule = {
  id: "r4",
  position: 4,
  enabled: true,
  type: "max_change_pct",
  scope: { campaigns: "all", actions: ["bid_change"] },
  params: { percent: 20 },
  outcome: "block",
  source_text: "Never change bids by more than 20%",
};
const SEED = [protectBrand, budgetOver50, pauseNeedsApproval];

const budget = (campaign: ProposedAction["campaign"], before: number, after: number): ProposedAction => ({
  type: "budget_change",
  campaign,
  before,
  after,
});
const bid = (campaign: ProposedAction["campaign"], before: number, after: number): ProposedAction => ({
  type: "bid_change",
  campaign,
  before,
  after,
});
const pause = (campaign: ProposedAction["campaign"]): ProposedAction => ({ type: "pause", campaign });

describe("protect", () => {
  it("blocks any action on the protected campaign", () => {
    const r = evaluate(budget(BRAND, 120, 125), [protectBrand]);
    expect(r.verdict).toBe("block");
    expect(r.reason).toContain("Brand Search is protected by rule #1");
  });

  it("leaves other campaigns alone", () => {
    expect(evaluate(budget(RETARGETING, 80, 85), [protectBrand]).verdict).toBe("allow");
  });

  it("only covers the listed actions when the scope names them", () => {
    const pauseOnly: Rule = { ...protectBrand, scope: { campaigns: [BRAND.id], actions: ["pause"] } };
    expect(evaluate(pause(BRAND), [pauseOnly]).verdict).toBe("block");
    expect(evaluate(bid(BRAND, 2.5, 2.6), [pauseOnly]).verdict).toBe("allow");
  });
});

describe("max_change_abs", () => {
  it("asks for approval above the dollar limit (demo step 4)", () => {
    const r = evaluate(budget(PROSPECTING, 200, 280), [budgetOver50]);
    expect(r.verdict).toBe("require_approval");
    expect(r.reason).toBe(
      'A $80/day change is over the $50/day limit in rule #2: "Budget changes over $50/day need my approval".',
    );
  });

  it("allows a change exactly at the limit", () => {
    expect(evaluate(budget(PROSPECTING, 200, 250), [budgetOver50]).verdict).toBe("allow");
  });

  it("counts cuts as well as increases", () => {
    expect(evaluate(budget(PROSPECTING, 200, 120), [budgetOver50]).verdict).toBe("require_approval");
  });

  it("does not apply a per-day budget limit to bids", () => {
    const anyAction: Rule = { ...budgetOver50, scope: { campaigns: "all", actions: "all" } };
    expect(evaluate(bid(PROSPECTING, 1.8, 90), [anyAction]).verdict).toBe("allow");
  });

  it("uses the outcome the rule sets", () => {
    const hardCap: Rule = { ...budgetOver50, outcome: "block" };
    expect(evaluate(budget(PROSPECTING, 200, 300), [hardCap]).verdict).toBe("block");
  });

  it("ignores float noise in cents", () => {
    const tenCents: Rule = { ...budgetOver50, params: { amount: 0.3, unit: "usd_per_day" } };
    expect(evaluate(budget(RETARGETING, 0.1, 0.4), [tenCents]).verdict).toBe("allow");
  });
});

describe("max_change_pct", () => {
  it("allows a change under the limit (demo step 3)", () => {
    const r = evaluate(bid(RETARGETING, 1.2, 1.08), [bidsOver20Pct]);
    expect(r.verdict).toBe("allow");
    expect(r.reason).toBe("No rules matched.");
  });

  it("fires above the limit", () => {
    const r = evaluate(bid(RETARGETING, 1.2, 0.84), [bidsOver20Pct]);
    expect(r.verdict).toBe("block");
    expect(r.reason).toContain("A 30% change is over the 20% limit in rule #4");
  });

  it("treats any change from zero as over the limit", () => {
    expect(evaluate(bid(RETARGETING, 0, 0.5), [bidsOver20Pct]).verdict).toBe("block");
  });

  it("does not apply to pausing", () => {
    const anyAction: Rule = { ...bidsOver20Pct, scope: { campaigns: "all", actions: "all" } };
    expect(evaluate(pause(RETARGETING), [anyAction]).verdict).toBe("allow");
  });
});

describe("action_policy", () => {
  it("asks for approval on every pause", () => {
    const r = evaluate(pause(RETARGETING), [pauseNeedsApproval]);
    expect(r.verdict).toBe("require_approval");
    expect(r.reason).toContain("Pausing is covered by rule #3");
  });

  it("does not touch other actions", () => {
    expect(evaluate({ type: "resume", campaign: RETARGETING }, [pauseNeedsApproval]).verdict).toBe("allow");
  });
});

describe("combinations", () => {
  it("lets the strictest rule win and still lists the others (demo step 5)", () => {
    const r = evaluate(pause(BRAND), SEED);
    expect(r.verdict).toBe("block");
    expect(r.matches.map((m) => m.position)).toEqual([1, 3]);
    expect(r.reason).toBe(
      'Brand Search is protected by rule #1: "Never touch Brand Search". Also matched #3; the stricter rule wins.',
    );
  });

  it("gives every reason when several rules agree", () => {
    const pctApproval: Rule = { ...bidsOver20Pct, scope: { campaigns: "all", actions: "all" }, outcome: "require_approval" };
    const r = evaluate(budget(PROSPECTING, 200, 280), [budgetOver50, pctApproval]);
    expect(r.verdict).toBe("require_approval");
    expect(r.matches).toHaveLength(2);
    expect(r.reason).toContain("rule #2");
    expect(r.reason).toContain("rule #4");
  });

  it("allows when nothing matches", () => {
    expect(evaluate(budget(RETARGETING, 80, 100), SEED)).toEqual({
      verdict: "allow",
      matches: [],
      reason: "No rules matched.",
    });
  });
});

describe("disabled rules", () => {
  it("are skipped", () => {
    const off: Rule = { ...protectBrand, enabled: false };
    expect(evaluate(budget(BRAND, 120, 125), [off]).verdict).toBe("allow");
  });

  it("do not hide the rules that stay on", () => {
    const off: Rule = { ...protectBrand, enabled: false };
    expect(evaluate(pause(BRAND), [off, pauseNeedsApproval]).verdict).toBe("require_approval");
  });
});

describe("rule schema", () => {
  it("accepts the example from SPEC.md", () => {
    const parsed = RuleDefinitionSchema.safeParse({
      type: "max_change_abs",
      scope: { campaigns: "all", actions: ["budget_change"] },
      params: { amount: 50, unit: "usd_per_day" },
      outcome: "require_approval",
      source_text: "Budget changes over $50/day need my approval",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a negative limit, an unknown type and an empty campaign list", () => {
    const base = { scope: { campaigns: "all", actions: "all" }, outcome: "block", source_text: "x" };
    expect(RuleDefinitionSchema.safeParse({ ...base, type: "max_change_pct", params: { percent: -5 } }).success).toBe(false);
    expect(RuleDefinitionSchema.safeParse({ ...base, type: "time_window", params: {} }).success).toBe(false);
    expect(
      RuleDefinitionSchema.safeParse({ ...base, type: "protect", params: {}, scope: { campaigns: [], actions: "all" } }).success,
    ).toBe(false);
  });
});
