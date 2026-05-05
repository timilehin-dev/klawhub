import { Skill, SkillContext } from "../types";
import { agentChat } from "@/core/llm";
import { getThreadHistory } from "@/utils/thread-context";

export const meetingSummarizationSkill: Skill = {
  name: "meeting_summarization",
  description: "Reads a Slack thread and outputs a structured summary with Action Items and Decisions.",
  matchPattern: /(summarize.*meeting|meeting.*summary|summarize.*thread|thread.*summary)/i,
  
  async execute(request: string, ctx: SkillContext): Promise<string> {
    if (!ctx.slackThreadTs) {
      return "I can only summarize a thread. Please reply to the thread you want me to summarize.";
    }

    const threadHistory = await getThreadHistory(ctx.slackChannelId, ctx.slackThreadTs, ctx.teamId, 50);
    
    if (!threadHistory) {
      return "There doesn't seem to be enough conversation in this thread to summarize.";
    }

    const prompt = `You are a highly efficient meeting summarizer. Read the following conversation and provide a concise, structured summary.

Format your output exactly like this (using Markdown):
*Summary:*
[1-2 sentences summarizing the overall discussion]

*Decisions Made:*
- [Decision 1]
- [Decision 2]
(If none, write "None")

*Action Items:*
- [@Person or Role] - [Action to take]
(If none, write "None")

Conversation:
${threadHistory}`;

    const response = await agentChat("analyst", [
      { role: "system", content: "You are a meeting summarizer." },
      { role: "user", content: prompt }
    ], { temperature: 0.3, maxTokens: 1000 }, ctx);

    return response;
  }
};
