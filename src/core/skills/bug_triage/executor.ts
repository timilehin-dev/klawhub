import { Skill, SkillContext } from "../types";
import { agentChat } from "@/core/llm";

export const bugTriageSkill: Skill = {
  name: "bug_triage",
  description: "Categorizes reported bugs, assesses severity, and suggests assignments based on context.",
  matchPattern: /(triage.*bug|bug.*report|fix.*this.*bug|categorize.*issue)/i,
  schema: {
    type: "object",
    properties: {
      request: { type: "string" }
    },
    required: ["request"]
  },
  
  async execute(request: string, ctx: SkillContext): Promise<string> {
    const prompt = `You are a Senior QA Engineer and Bug Triager. Analyze the following bug report/request.
    
    Report: "${request}"
    
    Please provide a triage report including:
    1. **Severity Assessment**: (Critical, High, Medium, Low) with a brief justification.
    2. **Root Cause Hypothesis**: Based on the description, where might the issue lie?
    3. **Suggested Next Steps**: (e.g., "Check logs in service X", "Verify DB connection pool").
    4. **Recommended Assignee Type**: (e.g., Backend, Frontend, DevOps).
    
    Format output for Slack.`;

    const response = await agentChat("qa", [
      { role: "system", content: "You are a bug triage expert." },
      { role: "user", content: prompt }
    ], { temperature: 0.2, maxTokens: 1000 }, ctx);

    return response;
  }
};
