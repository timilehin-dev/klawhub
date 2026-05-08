import { Skill, SkillContext } from "../types";
import { agentChat } from "@/core/llm";
import { getThreadHistory } from "@/utils/thread-context";

export const slackThreadAnalysisSkill: Skill = {
  name: "slack_thread_analysis",
  description: "Deeply analyzes a Slack thread to extract sentiment, key decisions, and unresolved questions.",
  matchPattern: /(analyze.*thread|thread.*analysis|sentiment.*analysis|what.*happened.*here)/i,
  schema: {
    type: "object",
    properties: {
      request: { type: "string" }
    },
    required: ["request"]
  },
  
  async execute(request: string, ctx: SkillContext): Promise<string> {
    if (!ctx.slackThreadTs) {
      return "I can only analyze a thread. Please reply to the thread you want me to look into.";
    }

    const threadHistory = await getThreadHistory(ctx.slackChannelId, ctx.slackThreadTs, ctx.teamId || "", 100);
    
    if (!threadHistory) {
      return "There doesn't seem to be any conversation in this thread to analyze.";
    }

    const prompt = `You are a Communication Analyst. Analyze the following Slack conversation.
    
    User Query: "${request}"
    
    Conversation:
    ${threadHistory}
    
    Provide a detailed analysis including:
    1. **Key Decisions**: List anything the team agreed upon.
    2. **Unresolved Questions**: List any questions that were asked but not answered.
    3. **Team Sentiment**: Briefly describe the tone of the discussion (e.g., constructive, urgent, frustrated).
    4. **Actionable Recommendations**: What should the team do next based on this thread?
    
    Format for Slack mrkdwn.`;

    const response = await agentChat("analyst", [
      { role: "system", content: "You are a communication and team dynamics analyst." },
      { role: "user", content: prompt }
    ], { temperature: 0.3, maxTokens: 1500 }, ctx);

    return response;
  }
};
