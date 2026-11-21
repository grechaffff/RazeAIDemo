import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): { db: DB; pool: Pool } {
  const pool = new Pool({ connectionString, max: 5 });
  return { db: drizzle(pool, { schema }), pool };
}

// One pool per server process; survives hot reloads in dev.
const globalForDb = globalThis as unknown as { __guardrailsDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__guardrailsDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
    globalForDb.__guardrailsDb = createDb(url).db;
  }
  return globalForDb.__guardrailsDb;
}
