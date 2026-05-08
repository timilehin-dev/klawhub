import { Skill, SkillContext } from "../types";
import { agentChat } from "@/core/llm";

export const calendarConflictResolutionSkill: Skill = {
  name: "calendar_conflict_resolution",
  description: "Detects scheduling conflicts and proposes alternative meeting times.",
  matchPattern: /(calendar.*conflict|schedule.*conflict|fix.*meeting|meeting.*overlap)/i,
  schema: {
    type: "object",
    properties: {
      request: { type: "string" }
    },
    required: ["request"]
  },
  
  async execute(request: string, ctx: SkillContext): Promise<string> {
    if (!ctx.workspaceId) {
      return "I need a workspace context to access calendar events. Please ensure your Google Workspace is connected.";
    }

    // Since this requires active Google Calendar API interaction, we will use the agent to drive the 'google_calendar_list_events' tool if needed, 
    // or just process the user's provided conflict description.
    
    const prompt = `You are a Scheduling Assistant. The user is reporting a calendar conflict or asking to resolve one.
    
    User Request: "${request}"
    
    Help the user resolve the conflict by:
    1. Identifying the overlapping events (if mentioned).
    2. Proposing a logic for prioritization.
    3. Suggesting how to use the 'google_calendar_list_events' tool to find a free slot if they need me to look for one.
    
    Format for Slack.`;

    const response = await agentChat("general", [
      { role: "system", content: "You are a scheduling and calendar coordination expert." },
      { role: "user", content: prompt }
    ], { temperature: 0.3, maxTokens: 1000 }, ctx);

    return response;
  }
};
