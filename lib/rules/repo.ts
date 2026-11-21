import { and, asc, eq, max } from "drizzle-orm";
import type { DB } from "../db/client";
import { campaigns, rules } from "../db/schema";
import { RuleDefinitionSchema, type Rule, type RuleDefinition } from "./schema";

type RuleRow = typeof rules.$inferSelect;

/** Turns a database row into a typed rule; throws if the stored JSON is broken. */
export function toRule(row: RuleRow): Rule {
  const def = RuleDefinitionSchema.parse({
    type: row.type,
    scope: row.scope,
    params: row.params,
    outcome: row.outcome,
    source_text: row.sourceText,
  });
  return { ...def, id: row.id, position: row.position, enabled: row.enabled };
}

export async function loadRules(db: DB, workspaceId: string): Promise<Rule[]> {
  const rows = await db.select().from(rules).where(eq(rules.workspaceId, workspaceId)).orderBy(asc(rules.position));
  return rows.map(toRule);
}

/** Saves a confirmed rule as the next number in the list. */
export async function createRule(
  db: DB,
  workspaceId: string,
  def: RuleDefinition,
): Promise<{ ok: true; rule: Rule } | { ok: false; error: string }> {
  // A rule may only name campaigns from this workspace.
  if (def.scope.campaigns !== "all") {
    const owned = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.workspaceId, workspaceId));
    const ownedIds = new Set(owned.map((c) => c.id));
    const foreign = def.scope.campaigns.filter((id) => !ownedIds.has(id));
    if (foreign.length) return { ok: false, error: `Unknown campaign id: ${foreign.join(", ")}` };
  }

  const [{ last }] = await db
    .select({ last: max(rules.position) })
    .from(rules)
    .where(eq(rules.workspaceId, workspaceId));

  const [row] = await db
    .insert(rules)
    .values({
      workspaceId,
      position: (last ?? 0) + 1,
      sourceText: def.source_text,
      type: def.type,
      scope: def.scope,
      params: def.params,
      outcome: def.outcome,
    })
    .returning();
  return { ok: true, rule: toRule(row) };
}

export async function setRuleEnabled(db: DB, workspaceId: string, ruleId: string, enabled: boolean) {
  const updated = await db
    .update(rules)
    .set({ enabled })
    .where(and(eq(rules.id, ruleId), eq(rules.workspaceId, workspaceId)))
    .returning();
  return updated[0] ? toRule(updated[0]) : null;
}
