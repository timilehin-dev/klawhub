import postgres from "postgres";

// Connection string from user
const connectionString = "postgresql://postgres.sabeiuxrflkndpahuczf:Timilehinklawhub@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?pgbouncer=true";

const client = postgres(connectionString, { prepare: false });

async function checkTables() {
  console.log("Checking tables in Supabase DB...");

  try {
    // List all tables
    const tablesResult = await client`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const existingTables = tablesResult.map(r => r.tablename);
    console.log("Existing tables:", existingTables);

    // Expected tables based on schema
    const expectedTables = [
      'runs', 'tasks', 'memory', 'skills', 'skill_usage', 'schedules', 'knowledge',
      'workspaces', 'workspace_members', 'integrations', 'engineer_learnings',
      'processed_events', 'usage_logs'
    ];

    console.log("Expected tables:", expectedTables);

    // Check missing
    const missing = expectedTables.filter(t => !existingTables.includes(t));
    if (missing.length > 0) {
      console.log("Missing tables:", missing);
    } else {
      console.log("All expected tables exist.");
    }

    // Check sample data or counts
    for (const tableName of existingTables) {
      try {
        const countResult = await client`SELECT COUNT(*) as count FROM ${client(tableName)}`;
        console.log(`${tableName}: ${countResult[0].count} rows`);
      } catch (err) {
        console.log(`${tableName}: Error counting - ${err.message}`);
      }
    }

  } catch (err) {
    console.error("DB check failed:", err);
  } finally {
    await client.end();
  }
}

checkTables();