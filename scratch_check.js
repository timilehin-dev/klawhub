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
  const sql = postgres(connectionString);
  try {
    const rows = await sql`SELECT * FROM workspaces LIMIT 1`;
    if (rows.length > 0) {
      console.log("Keys in workspaces row:", Object.keys(rows[0]));
      console.log("Row agent_name:", rows[0].agent_name);
      console.log("Row enabled_skills:", rows[0].enabled_skills);
    } else {
      console.log("No workspaces in database yet.");
    }
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await sql.end();
  }
}

run();
