import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // Fallback to .env
}

async function test() {
  // We use dynamic import to ensure dotenv.config() has run before any DB connections are initialized
  const { activeSkills, matchSkill } = await import("../core/skills/loader");
  
  console.log("--- Testing Skill Loader ---");
  console.log("Active Skills count:", activeSkills.length);
  
  activeSkills.forEach(s => {
    console.log(`- [${s.name}]: ${s.description.substring(0, 50)}...`);
  });

  const testRequests = [
    "break down this project into subtasks",
    "summarize this meeting thread",
    "research competitors for a fintech app",
    "plan next sprint",
    "analyze this thread sentiment",
    "triage this bug report",
    "resolve calendar conflict"
  ];

  console.log("\n--- Testing Intent Matching ---");
  testRequests.forEach(req => {
    const match = matchSkill(req);
    console.log(`Request: "${req}" -> Match: ${match ? match.name : "NONE"}`);
  });
}

test().catch(console.error);
