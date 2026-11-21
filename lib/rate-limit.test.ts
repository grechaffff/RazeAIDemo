import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./db/client";
import { llmCalls } from "./db/schema";
import { LIMITS, checkLlmLimit, clientIp } from "./rate-limit";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

describe("clientIp", () => {
  it("takes the first address from x-forwarded-for", () => {
    const r = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    expect(clientIp(r)).toBe("203.0.113.7");
  });
});

suite("checkLlmLimit", () => {
  const { db, pool } = createDb(url ?? "postgres://unused");

  beforeEach(async () => {
    await db.delete(llmCalls);
  });
  afterAll(async () => {
    await db.delete(llmCalls);
    await pool.end();
  });

  it("allows up to the per-IP limit, then refuses that IP only", async () => {
    for (let i = 0; i < LIMITS.perIp.max; i++) expect(await checkLlmLimit(db, "1.1.1.1", "agent")).toBeNull();
    expect(await checkLlmLimit(db, "1.1.1.1", "agent")).toMatch(/Too many requests/);
    expect(await checkLlmLimit(db, "2.2.2.2", "agent")).toBeNull();
  });

  it("lets an IP back in once the window has passed", async () => {
    const past = new Date(Date.now() - LIMITS.perIp.windowMs - 1000);
    for (let i = 0; i < LIMITS.perIp.max; i++) await checkLlmLimit(db, "3.3.3.3", "agent", past);
    expect(await checkLlmLimit(db, "3.3.3.3", "agent")).toBeNull();
  });
});
