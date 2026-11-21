import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listDecisions } from "../actions/propose";
import { createDb } from "../db/client";
import { workspaces } from "../db/schema";
import { createSeededWorkspace } from "../db/seed";
import { buildMcpServer } from "./server";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("MCP server", () => {
  const { db, pool } = createDb(url ?? "postgres://unused");
  const created: string[] = [];
  let ws: string;
  let client: Client;

  beforeEach(async () => {
    ws = await createSeededWorkspace(db);
    created.push(ws);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(db, ws).connect(serverSide);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
  });

  afterAll(async () => {
    if (created.length) await db.delete(workspaces).where(inArray(workspaces.id, created));
    await pool.end();
  });

  const text = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as Array<{ text: string }>)[0].text;

  it("offers the two tools with honest hints", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_campaigns", "propose_action"]);
    expect(tools.find((t) => t.name === "list_campaigns")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "propose_action")?.inputSchema.required).toEqual(["action", "campaign", "reason"]);
  });

  it("blocks Brand Search over MCP exactly like the chat does (demo step 6)", async () => {
    const r = await client.callTool({
      name: "propose_action",
      arguments: { action: "pause", campaign: "Brand Search", reason: "too expensive" },
    });
    expect(r.isError).toBe(false);
    expect(JSON.parse(text(r))).toMatchObject({ verdict: "block", applied: false, campaign: "Brand Search" });

    const [decision] = await listDecisions(db, ws);
    expect(decision).toMatchObject({ channel: "mcp", verdict: "block" });
  });

  it("holds a big budget change for approval", async () => {
    const r = await client.callTool({
      name: "propose_action",
      arguments: { action: "budget_change", campaign: "Prospecting", change_by: 80, reason: "scale" },
    });
    expect(JSON.parse(text(r))).toMatchObject({ verdict: "require_approval", applied: false });
  });

  it("reports bad requests as tool errors", async () => {
    const r = await client.callTool({
      name: "propose_action",
      arguments: { action: "pause", campaign: "Nope", reason: "x" },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('No campaign "Nope"');
  });

  it("lists only this workspace's campaigns", async () => {
    const r = await client.callTool({ name: "list_campaigns", arguments: {} });
    expect(JSON.parse(text(r)).campaigns).toHaveLength(4);
  });
});
