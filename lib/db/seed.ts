import { eq } from "drizzle-orm";
import type { DB } from "./client";
import { actions, campaigns, rules, workspaces } from "./schema";

/** The Acme Outdoor demo account from SPEC.md. */
export const DEMO_CAMPAIGNS = [
  { name: "Brand Search", platform: "google", dailyBudgetUsd: 120, bidUsd: 2.5 },
  { name: "Prospecting — Lookalike", platform: "meta", dailyBudgetUsd: 200, bidUsd: 1.8 },
  { name: "Retargeting", platform: "meta", dailyBudgetUsd: 80, bidUsd: 1.2 },
  { name: "Shopping — New Arrivals", platform: "google", dailyBudgetUsd: 150, bidUsd: 0.9 },
] as const;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Fills an empty workspace with the demo campaigns and the three starting rules. */
async function seedInto(tx: Tx, workspaceId: string) {
  const inserted = await tx
    .insert(campaigns)
    .values(DEMO_CAMPAIGNS.map((c) => ({ ...c, workspaceId })))
    .returning({ id: campaigns.id, name: campaigns.name });

  const idOf = (name: string) => {
    const found = inserted.find((c) => c.name === name);
    if (!found) throw new Error(`Seed campaign missing: ${name}`);
    return found.id;
  };

  await tx.insert(rules).values([
    {
      workspaceId,
      position: 1,
      sourceText: "Never touch Brand Search",
      type: "protect",
      scope: { campaigns: [idOf("Brand Search")], actions: "all" },
      params: {},
      outcome: "block",
    },
    {
      workspaceId,
      position: 2,
      sourceText: "Budget changes over $50/day need my approval",
      type: "max_change_abs",
      scope: { campaigns: "all", actions: ["budget_change"] },
      params: { amount: 50, unit: "usd_per_day" },
      outcome: "require_approval",
    },
    {
      workspaceId,
      position: 3,
      sourceText: "Pausing a campaign always needs approval",
      type: "action_policy",
      scope: { campaigns: "all", actions: ["pause"] },
      params: {},
      outcome: "require_approval",
    },
  ]);
}

export async function createSeededWorkspace(db: DB): Promise<string> {
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({}).returning({ id: workspaces.id });
    await seedInto(tx, ws.id);
    return ws.id;
  });
}

/** Reset demo: wipe everything in one visitor's workspace and seed it again. */
export async function resetWorkspace(db: DB, workspaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Deleting actions cascades to decisions; campaigns and rules go next.
    await tx.delete(actions).where(eq(actions.workspaceId, workspaceId));
    await tx.delete(rules).where(eq(rules.workspaceId, workspaceId));
    await tx.delete(campaigns).where(eq(campaigns.workspaceId, workspaceId));
    await seedInto(tx, workspaceId);
  });
}
