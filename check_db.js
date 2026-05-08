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
    return;
  }

  const sql = postgres(connectionString);

  try {
    console.log("--- Checking/Fixing Database Schema ---");
    
    // 1. Check usage_logs columns
    let columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'usage_logs'
    `;
    
    let hasWorkspaceId = columns.some(c => c.column_name === 'workspace_id');
    console.log("Initial workspace_id check:", hasWorkspaceId);

    if (!hasWorkspaceId) {
      console.log("Column 'workspace_id' is missing. Attempting to add it...");
      try {
        await sql`ALTER TABLE usage_logs ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE`;
        console.log("Successfully added 'workspace_id' column.");
        hasWorkspaceId = true;
      } catch (migrateErr) {
        console.error("Migration failed:", migrateErr.message);
      }
    }

    // 2. Final check
    columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'usage_logs'
    `;
    console.log("Current Columns:", columns.map(c => c.column_name).join(", "));
    console.log("Has workspace_id:", columns.some(c => c.column_name === 'workspace_id'));

    console.log("\n--- Verification Complete ---");
  } catch (err) {
    console.error("Error during DB check:", err);
  } finally {
    await sql.end();
  }
}

run();