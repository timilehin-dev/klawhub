import { Skill, SkillContext } from "../types";
import { agentChat } from "@/core/llm";

export const taskBreakdownSkill: Skill = {
  name: "task_breakdown",
  description: "Takes a large request and splits it into a structured sub-task JSON or markdown list.",
  matchPattern: /(break.*down.*task|create.*subtasks|split.*task|subtasks)/i,
  
  async execute(request: string, ctx: SkillContext): Promise<string> {
    const prompt = `You are a strict Project Manager. Your job is to take the user's request and break it down into a logical sequence of actionable sub-tasks.

User Request:
"${request}"

Output a clean Markdown checklist format for the sub-tasks, like this:
*Task Breakdown:*
- [ ] Task 1: [Description]
- [ ] Task 2: [Description]

Make the tasks sequential and logical. Do not provide any conversational filler.`;

    const response = await agentChat("pm", [
      { role: "system", content: "You are a task breakdown engine." },
      { role: "user", content: prompt }
    ], { temperature: 0.2, maxTokens: 1000 }, ctx);

    // Strip rogue markdown wrapper if present
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith("```markdown")) {
      cleanResponse = cleanResponse.replace(/^```markdown\n?/i, "").replace(/```$/i, "").trim();
    } else if (cleanResponse.startsWith("```")) {
      cleanResponse = cleanResponse.replace(/^```\n?/i, "").replace(/```$/i, "").trim();
    }

    return cleanResponse;
  }
};
