import type Anthropic from "@anthropic-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listDecisions } from "../actions/propose";
import { createDb } from "../db/client";
import { campaigns, workspaces } from "../db/schema";
import { createSeededWorkspace } from "../db/seed";
import { runAgent } from "./agent";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

/** A stand-in model that replies with scripted turns, in order. */
function scriptedModel(...turns: Block[][]) {
  const create = vi.fn();
  for (const content of turns) {
    const usesTool = content.some((b) => b.type === "tool_use");
    create.mockResolvedValueOnce({ content, stop_reason: usesTool ? "tool_use" : "end_turn" });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

/** The tool_result blocks the agent sent back on a given model call. */
function toolResultsSentOn(create: ReturnType<typeof vi.fn>, call: number) {
  const messages = create.mock.calls[call][0].messages as Anthropic.MessageParam[];
  return messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
}

suite("runAgent", () => {
  const { db, pool } = createDb(url ?? "postgres://unused");
  const created: string[] = [];
  let ws: string;

  beforeEach(async () => {
    ws = await createSeededWorkspace(db);
    created.push(ws);
  });

  afterAll(async () => {
    if (created.length) await db.delete(workspaces).where(inArray(workspaces.id, created));
    await pool.end();
  });

  it("routes the model's change through the rules and hands back the verdict (demo step 5)", async () => {
    const { client, create } = scriptedModel(
      [
        { type: "text", text: "Pausing it." },
        { type: "tool_use", id: "t1", name: "propose_action", input: { action: "pause", campaign: "Brand Search", reason: "too expensive" } },
      ],
      [{ type: "text", text: "I can't pause Brand Search: rule #1 protects it. I could lower its bid instead." }],
    );

    const turn = await runAgent(client, db, ws, [{ role: "user", content: "Pause Brand Search, it's too expensive" }]);

    expect(turn.reply).toContain("rule #1 protects it");
    expect(turn.actions).toHaveLength(1);
    expect(turn.actions[0]).toMatchObject({ verdict: "block", applied: false, campaign: { name: "Brand Search" } });

    const [result] = toolResultsSentOn(create, 1);
    expect(result.tool_use_id).toBe("t1");
    expect(JSON.parse(result.content as string)).toMatchObject({ verdict: "block", applied: false });

    const [decision] = await listDecisions(db, ws);
    expect(decision).toMatchObject({ channel: "chat", verdict: "block" });
    const [brand] = await db.select().from(campaigns).where(eq(campaigns.workspaceId, ws)).then((rows) => rows.filter((c) => c.name === "Brand Search"));
    expect(brand.status).toBe("active");
  });

  it("lets the model read campaigns, then applies an allowed change (demo step 3)", async () => {
    const { client, create } = scriptedModel(
      [{ type: "tool_use", id: "t1", name: "list_campaigns", input: {} }],
      [{ type: "tool_use", id: "t2", name: "propose_action", input: { action: "bid_change", campaign: "Retargeting", change_by_pct: -10, reason: "lower bids" } }],
      [{ type: "text", text: "Done: Retargeting bid is now $1.08." }],
    );

    const turn = await runAgent(client, db, ws, [{ role: "user", content: "Lower bids on Retargeting by 10%" }]);

    const listed = JSON.parse(toolResultsSentOn(create, 1)[0].content as string);
    expect(listed.campaigns.map((c: { name: string }) => c.name)).toContain("Retargeting");
    expect(turn.actions[0]).toMatchObject({ verdict: "allow", applied: true, after: { value: 1.08 } });
  });

  it("returns a tool error for bad input and writes nothing", async () => {
    const { client, create } = scriptedModel(
      [{ type: "tool_use", id: "t1", name: "propose_action", input: { action: "delete_everything", campaign: "Brand Search" } }],
      [{ type: "text", text: "Sorry, I can't do that." }],
    );

    const turn = await runAgent(client, db, ws, [{ role: "user", content: "Delete everything" }]);

    expect(toolResultsSentOn(create, 1)[0]).toMatchObject({ is_error: true });
    expect(turn.actions).toHaveLength(0);
    expect(await listDecisions(db, ws)).toHaveLength(0);
  });
});
