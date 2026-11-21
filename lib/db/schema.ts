import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** One demo workspace per visitor. Its id lives in a cookie and in the MCP URL. */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default("Acme Outdoor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform", { enum: ["google", "meta"] }).notNull(),
    dailyBudgetUsd: numeric("daily_budget_usd", { precision: 10, scale: 2, mode: "number" }).notNull(),
    bidUsd: numeric("bid_usd", { precision: 10, scale: 2, mode: "number" }).notNull(),
    status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
  },
  (t) => [index("campaigns_workspace_idx").on(t.workspaceId)],
);

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Display order: "rule #1" is position 1. */
    position: integer("position").notNull(),
    sourceText: text("source_text").notNull(),
    type: text("type").notNull(),
    scope: jsonb("scope").notNull(),
    params: jsonb("params").notNull(),
    outcome: text("outcome", { enum: ["require_approval", "block"] }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rules_workspace_idx").on(t.workspaceId)],
);

export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["chat", "mcp", "api"] }).notNull(),
    actionType: text("action_type").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("actions_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionId: uuid("action_id")
    .notNull()
    .unique()
    .references(() => actions.id, { onDelete: "cascade" }),
  verdict: text("verdict", { enum: ["allow", "require_approval", "block"] }).notNull(),
  matchedRuleIds: jsonb("matched_rule_ids").$type<string[]>().notNull(),
  explanation: text("explanation").notNull(),
  /** Set only for require_approval decisions once a human acts on them. */
  resolution: text("resolution", { enum: ["approved", "denied"] }),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/** One row per LLM-backed request, for per-IP and daily limits on the API key. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ip: text("ip").notNull(),
    route: text("route").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_ip_idx").on(t.ip, t.createdAt), index("llm_calls_created_idx").on(t.createdAt)],
);
