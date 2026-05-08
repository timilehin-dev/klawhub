import { Skill, SkillContext } from "../types";
import { agentChat } from "@/core/llm";
import { tavily } from "@/core/tools/web-search";

export const competitorResearchSkill: Skill = {
  name: "competitor_research",
  description: "Aggregates web data on competitors and synthesizes a competitive intelligence report.",
  matchPattern: /(competitor.*research|research.*competitor|compare.*competitor)/i,
  schema: {
    type: "object",
    properties: {
      request: { type: "string" }
    },
    required: ["request"]
  },
  
  async execute(request: string, ctx: SkillContext): Promise<string> {
    // 1. Ask the PM to extract the core competitor names from the prompt
    const extractPrompt = `Extract the primary company/competitor names from this request: "${request}". Output ONLY a comma-separated list of names. If none, output "none".`;
    const namesRaw = await agentChat("pm", [{ role: "user", content: extractPrompt }], { temperature: 0 }, ctx);
    
    if (namesRaw.toLowerCase().includes("none")) {
      return "I need specific competitor names to run a research report. Please reply with the companies you want me to look into.";
    }

    const competitors = namesRaw.split(",").map(c => c.trim());
    let researchData = "";

    // 2. Perform web searches for each competitor
    for (const comp of competitors) {
      const results = await tavily.search(`${comp} company pricing features recent news`, 3);
      researchData += `\n\n### Raw Data for ${comp}:\n`;
      researchData += results.map((r: any) => `- [${r.title}](${r.url}): ${r.content}`).join("\n");
    }

    // 3. Synthesize the report
    const synthPrompt = `You are a Competitive Intelligence Analyst. Synthesize the following web search data into a structured Competitor Research Report.
    
    Focus on:
    1. Core Offerings & Features
    2. Pricing Strategy (if found)
    3. Recent News / Positioning
    
    Raw Data:
    ${researchData}`;

    const report = await agentChat("researcher", [
      { role: "system", content: "You are a competitive intelligence expert." },
      { role: "user", content: synthPrompt }
    ], { temperature: 0.3, maxTokens: 2000 }, ctx);

    return report;
  },

  async onCompleteSaveToMemory(request: string, result: string, ctx: SkillContext): Promise<string | null> {
    // Extract key facts to save to vector memory
    return `Competitive intelligence run for request: "${request}". Summary of findings: ${result.substring(0, 500)}...`;
  }
};
