const postgres = require("postgres");
// We can load from .env.local manually if dotenv is not installed in scratch space, or just rely on process.env since Next.js loads it
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
    console.error("DATABASE_URL is not set in .env.local");
    process.exit(1);
  }

  console.log("Connecting to Postgres...");
  const sql = postgres(connectionString);
  try {
    console.log("Running ALTER TABLE queries on workspaces...");
    await sql`
      ALTER TABLE workspaces 
      ADD COLUMN IF NOT EXISTS agent_name TEXT NOT NULL DEFAULT 'Klawhub',
      ADD COLUMN IF NOT EXISTS agent_personality TEXT,
      ADD COLUMN IF NOT EXISTS enabled_skills JSONB NOT NULL DEFAULT '["web_search", "puppeteer_scraping", "python_sandbox", "pdf_generator", "email_dispatch"]'::jsonb;
    `;
    console.log("✅ Database columns added successfully!");
  } catch (err) {
    console.error("❌ Migration query failed:", err);
  } finally {
    await sql.end();
  }
}

run();
