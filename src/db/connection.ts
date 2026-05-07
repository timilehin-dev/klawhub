import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Prevent multiple connections in development / serverless fast-refresh environments
const globalForDb = globalThis as unknown as {
  _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

export function getDb() {
  if (!globalForDb._db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    
    // Serverless functions process requests sequentially, so each container only needs a maximum of 1 connection.
    // This prevents running out of connections on providers with tight pool limits (e.g., Supabase/Neon session pool limit of 15).
    globalForDb._db = drizzle(postgres(connectionString, { prepare: false, max: 1 }), { schema });
  }
  return globalForDb._db;
}

// Re-export for lazy usage — callers use getDb() at request time
export type Database = ReturnType<typeof drizzle<typeof schema>>;
