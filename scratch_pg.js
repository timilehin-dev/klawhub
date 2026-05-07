const { Client } = require("pg");
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
    console.error("DATABASE_URL is not set");
    return;
  }
  console.log("Connecting using 'pg' client...");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    console.log("Applying ALTER TABLE column additions...");
    await client.query(`
      ALTER TABLE workspaces 
      ADD COLUMN IF NOT EXISTS agent_name TEXT NOT NULL DEFAULT 'Klawhub',
      ADD COLUMN IF NOT EXISTS agent_personality TEXT,
      ADD COLUMN IF NOT EXISTS enabled_skills JSONB NOT NULL DEFAULT '["web_search", "puppeteer_scraping", "python_sandbox", "pdf_generator", "email_dispatch"]'::jsonb;
    `);
    console.log("✅ Done!");
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await client.end();
  }
}
run();
