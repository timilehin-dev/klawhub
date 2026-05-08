import { Skill, SkillContext } from "../types";
import { agentChat } from "@/core/llm";
import { getThreadHistory } from "@/utils/thread-context";

export const sprintPlanningSkill: Skill = {
  name: "sprint_planning",
  description: "Analyzes recent team discussions and task backlog to propose a structured sprint plan.",
  matchPattern: /(sprint.*planning|plan.*sprint|next.*sprint|sprint.*goals)/i,
  schema: {
    type: "object",
    properties: {
      request: { type: "string" }
    },
    required: ["request"]
  },
  
  async execute(request: string, ctx: SkillContext): Promise<string> {
    // 1. Gather context from the current thread (if any) or recently finished tasks
    let context = "";
    if (ctx.slackThreadTs) {
      context = await getThreadHistory(ctx.slackChannelId, ctx.slackThreadTs, ctx.teamId || "", 30) || "";
    }

    const prompt = `You are a Project Manager and Scrum Master. Based on the user's request and the recent conversation history, propose a structured Sprint Plan.
    
    User Request: "${request}"
    
    Recent Context:
    ${context}
    
    Provide the following in your report:
    1. **Sprint Goal**: A clear, concise focus for the next cycle.
    2. **Priority Items**: 3-5 high-level tasks or themes to tackle.
    3. **Risks/Blockers**: Any potential issues mentioned or inferred.
    
    Format the output cleanly in Markdown for Slack.`;

    const response = await agentChat("pm", [
      { role: "system", content: "You are a professional Scrum Master and PM." },
      { role: "user", content: prompt }
    ], { temperature: 0.4, maxTokens: 1500 }, ctx);

    return response;
  },

  async onCompleteSaveToMemory(request: string, result: string, ctx: SkillContext): Promise<string | null> {
    return `Sprint planning session initiated. Goal/Themes identified: ${result.substring(0, 300)}...`;
  }
};
