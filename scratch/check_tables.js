const postgres = require("postgres");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    envContent.split("\n").forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    });
  }
}

async function run() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set in env");
    process.exit(1);
  }

  const sql = postgres(connectionString);
  try {
    const res = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    console.log("--- TABLES IN DATABASE ---");
    res.forEach(row => console.log(row.table_name));
    console.log("--------------------------");
    
    // Check if any tables exist
    if (res.length === 0) {
      console.log("No tables found in the database!");
    }
    
    // Check for specific tables from schema
    const expectedTables = [
      'workspaces', 'workspace_members', 'integrations', 'webhooks',
      'runs', 'tasks', 'memory', 'skills', 'skill_usage', 'schedules',
      'knowledge', 'engineer_learnings', 'processed_events', 'agent_states',
      'usage_logs', 'workflow_learnings'
    ];
    
    const foundTables = res.map(row => row.table_name);
    const missingTables = expectedTables.filter(t => !foundTables.includes(t));
    
    if (missingTables.length > 0) {
      console.log("\n--- MISSING TABLES ---");
      missingTables.forEach(table => console.log(`- ${table}`));
      console.log("----------------------");
    } else {
      console.log("\nAll expected tables are present!");
    }
    
  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    await sql.end();
  }
}

run();