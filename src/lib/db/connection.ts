import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    _db = drizzle(postgres(connectionString, { prepare: false, max: 10 }), { schema });
  }
  return _db;
}

// Re-export for lazy usage — callers use getDb() at request time
export type Database = ReturnType<typeof drizzle<typeof schema>>;
