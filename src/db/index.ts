import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

export const dbEnabled = Boolean(databaseUrl);

function create() {
  if (!databaseUrl) return null;
  return drizzle(new Pool({ connectionString: databaseUrl }));
}

type Db = ReturnType<typeof create>;

const globalForDb = globalThis as typeof globalThis & {
  __aurelionDb?: Db;
};

// Lazily-created, process-cached database handle. null when no DATABASE_URL —
// the API layer falls back to the file store in that case.
export const db: Db = globalForDb.__aurelionDb ?? create();
if (process.env.NODE_ENV !== "production") globalForDb.__aurelionDb = db;

export const pool = dbEnabled ? (db as unknown as { session: { client: Pool } }).session.client : null;
