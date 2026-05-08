import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

import { inngest } from "../workflows/client";

async function testBrief() {
  console.log("--- Testing Morning Brief Workflow ---");
  
  // We'll manually trigger the inngest function logic or just call the handler
  // For simplicity in testing, we import the handler logic
  const { morningBriefWorkflow } = await import("../workflows/morning-brief");
  
  console.log("Found workflow:", morningBriefWorkflow.name);
  
  // In a real test, we would use inngest.send() or similar
  // But here we just want to see if it executes without crash
  console.log("Note: This script verifies imports and structure. To run fully, use the Inngest Dev Server.");
}

testBrief().catch(console.error);
