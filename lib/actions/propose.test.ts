import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { campaigns, workspaces } from "../db/schema";
import { createSeededWorkspace } from "../db/seed";
import { createRule } from "../rules/repo";
import { approveDecision, denyDecision, listDecisions, proposeAction } from "./propose";

// Runs against a real Postgres. Set TEST_DATABASE_URL (see .env.example) to enable.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("proposeAction against Postgres", () => {
  const { db, pool } = createDb(url ?? "postgres://unused");
  const created: string[] = [];
  let ws: string;

  const campaign = async (name: string) => {
    const all = await db.select().from(campaigns).where(eq(campaigns.workspaceId, ws));
    const found = all.find((c) => c.name === name);
    if (!found) throw new Error(`No campaign ${name}`);
    return found;
  };

  beforeEach(async () => {
    ws = await createSeededWorkspace(db);
    created.push(ws);
  });

  afterAll(async () => {
    if (created.length) await db.delete(workspaces).where(inArray(workspaces.id, created));
    await pool.end();
  });

  it("applies an allowed change right away (demo step 3)", async () => {
    const r = await proposeAction(db, {
      workspaceId: ws,
      channel: "chat",
      actionType: "bid_change",
      campaign: "Retargeting",
      changeByPct: -10,
      reason: "lower bids",
    });
    expect(r).toMatchObject({ ok: true, verdict: "allow", applied: true, before: { value: 1.2 }, after: { value: 1.08 } });
    expect((await campaign("Retargeting")).bidUsd).toBe(1.08);
  });

  it("holds a change over the limit until a person approves it (demo step 4)", async () => {
    const r = await proposeAction(db, {
      workspaceId: ws,
      channel: "chat",
      actionType: "budget_change",
      campaign: "Prospecting",
      changeBy: 80,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.verdict).toBe("require_approval");
    expect(r.applied).toBe(false);
    expect((await campaign("Prospecting — Lookalike")).dailyBudgetUsd).toBe(200);

    expect(await approveDecision(db, ws, r.decisionId)).toEqual({ ok: true });
    expect((await campaign("Prospecting — Lookalike")).dailyBudgetUsd).toBe(280);
    expect(await approveDecision(db, ws, r.decisionId)).toEqual({ ok: false, error: "Already resolved." });
  });

  it("leaves the campaign unchanged on deny", async () => {
    const r = await proposeAction(db, { workspaceId: ws, channel: "chat", actionType: "pause", campaign: "Retargeting" });
    if (!r.ok) throw new Error(r.error);
    expect(r.verdict).toBe("require_approval");
    expect(await denyDecision(db, ws, r.decisionId)).toEqual({ ok: true });
    expect((await campaign("Retargeting")).status).toBe("active");
  });

  it("blocks the same request from chat and MCP alike (demo steps 5 and 6)", async () => {
    for (const channel of ["chat", "mcp"] as const) {
      const r = await proposeAction(db, { workspaceId: ws, channel, actionType: "pause", campaign: "brand search" });
      expect(r).toMatchObject({ ok: true, verdict: "block", applied: false });
      if (r.ok) expect(r.matches.map((m) => m.position)).toEqual([1, 3]);
    }
    expect((await campaign("Brand Search")).status).toBe("active");

    const log = await listDecisions(db, ws);
    expect(log.map((d) => d.channel)).toEqual(["mcp", "chat"]);
    expect(log.every((d) => d.verdict === "block")).toBe(true);
  });

  it("checks the rules again on approve", async () => {
    const r = await proposeAction(db, { workspaceId: ws, channel: "chat", actionType: "budget_change", campaign: "Prospecting", value: 300 });
    if (!r.ok) throw new Error(r.error);
    await createRule(db, ws, {
      type: "protect",
      scope: { campaigns: [r.campaign.id], actions: "all" },
      params: {},
      outcome: "block",
      source_text: "Never touch Prospecting",
    });
    const approved = await approveDecision(db, ws, r.decisionId);
    expect(approved.ok).toBe(false);
    expect((await campaign("Prospecting — Lookalike")).dailyBudgetUsd).toBe(200);
  });

  it("rejects bad input without writing to the log", async () => {
    const base = { workspaceId: ws, channel: "chat" as const };
    expect(await proposeAction(db, { ...base, actionType: "pause", campaign: "Nope" })).toMatchObject({ ok: false });
    expect(
      await proposeAction(db, { ...base, actionType: "budget_change", campaign: "Retargeting", value: 90, changeBy: 10 }),
    ).toMatchObject({ ok: false });
    expect(await proposeAction(db, { ...base, actionType: "bid_change", campaign: "Retargeting", changeByPct: -100 })).toMatchObject({
      ok: false,
    });
    expect(await proposeAction(db, { ...base, actionType: "resume", campaign: "Retargeting" })).toMatchObject({ ok: false });
    expect(await listDecisions(db, ws)).toHaveLength(0);
  });

  it("never reaches campaigns or decisions of another workspace", async () => {
    const other = await createSeededWorkspace(db);
    created.push(other);
    const [foreign] = await db.select().from(campaigns).where(eq(campaigns.workspaceId, other));

    expect(await proposeAction(db, { workspaceId: ws, channel: "mcp", actionType: "pause", campaign: foreign.id })).toMatchObject({
      ok: false,
    });

    const r = await proposeAction(db, { workspaceId: other, channel: "chat", actionType: "pause", campaign: "Retargeting" });
    if (!r.ok) throw new Error(r.error);
    expect(await approveDecision(db, ws, r.decisionId)).toEqual({ ok: false, error: "Decision not found." });
  });
});
