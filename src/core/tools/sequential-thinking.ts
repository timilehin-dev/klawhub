import { ToolDefinition } from "./registry";

/**
 * Sequential Thinking Tool
 * 
 * Provides a structured way for agents to process complex tasks,
 * evaluate performance trade-offs, and maintain a stateful reasoning chain.
 * This tool is designed to prevent "jumping to conclusions" and enforces
 * the selection of the fastest/leanest tools (Polars, lxml, etc.).
 * 
 * The tool produces DIRECTIVE output — instead of just echoing thoughts,
 * it generates concrete next-action instructions and accumulates a plan.
 */

export const sequentialThinkingTool: ToolDefinition = {
  name: "sequential_thinking",
  description: "MANDATORY FIRST STEP: A tool for structured reasoning and strategic planning. You MUST use this tool FIRST for any complex, multi-step, or ambiguous request before using any other tool. Use this to break down the request into steps, evaluate trade-offs, flag uncertainties, and produce a concrete action plan. Each thought produces a DIRECTIVE output telling you what to do next.",
  parameters: {
    thought: {
      type: "string",
      description: "The current reasoning step or strategy evaluation",
      required: true,
    },
    thoughtNumber: {
      type: "number",
      description: "The current thought number in the sequence",
      required: true,
    },
    totalThoughts: {
      type: "number",
      description: "Estimated total number of thoughts needed (can be adjusted)",
      required: true,
    },
    nextThoughtNeeded: {
      type: "boolean",
      description: "Whether another thought step is required before action",
      required: true,
    },
    plan: {
      type: "string",
      description: "JSON array of planned actions, each with: {\"tool\": \"tool_name\", \"purpose\": \"what this step achieves\", \"params_hint\": \"key parameters\"}. Build this up across thoughts.",
    },
    uncertainties: {
      type: "string",
      description: "What you DON'T know yet and need to research or ask about. List specific unknowns.",
    },
    conclusion: {
      type: "string",
      description: "Final summary of the decided approach (only in the last thought when nextThoughtNeeded=false)",
    },
    strategy: {
      type: "string",
      description: "The specific performant library or lean approach selected (e.g., 'Polars', 'lxml', 'regex-only')",
    },
    isRevision: {
      type: "boolean",
      description: "Whether this thought revises previous thinking or changes the strategy",
    },
    revisesThought: {
      type: "number",
      description: "Which previous thought number is being reconsidered (if isRevision is true)",
    },
    branchFromThought: {
      type: "number",
      description: "If branching into a new approach, which thought number is the branching point",
    },
  },
  async execute(params, _ctx) {
    const {
      thought, thoughtNumber, totalThoughts, nextThoughtNeeded,
      plan, uncertainties, conclusion, strategy,
      isRevision, revisesThought, branchFromThought
    } = params;
    
    const lines: string[] = [];
    
    // Header
    lines.push(`━━━ THOUGHT ${thoughtNumber}/${totalThoughts} ━━━`);
    if (isRevision) {
      lines.push(`⟲ REVISING thought ${revisesThought}`);
    }
    if (branchFromThought) {
      lines.push(`⑂ BRANCHING from thought ${branchFromThought}`);
    }
    
    // Main thought
    lines.push("");
    lines.push(thought);
    
    // Strategy selection
    if (strategy) {
      lines.push("");
      lines.push(`🎯 SELECTED STRATEGY: ${strategy}`);
    }
    
    // Uncertainties — things to resolve
    if (uncertainties) {
      lines.push("");
      lines.push(`⚠️ UNKNOWNS TO RESOLVE:`);
      lines.push(uncertainties);
    }
    
    // Action plan
    if (plan) {
      lines.push("");
      lines.push(`📋 ACTION PLAN:`);
      try {
        const steps = JSON.parse(plan);
        if (Array.isArray(steps)) {
          steps.forEach((step: any, i: number) => {
            lines.push(`  ${i + 1}. [${step.tool}] ${step.purpose}${step.params_hint ? ` → ${step.params_hint}` : ""}`);
          });
        }
      } catch {
        lines.push(`  ${plan}`);
      }
    }
    
    // Directive
    lines.push("");
    if (nextThoughtNeeded) {
      lines.push(`→ NEXT: Continue reasoning (thought ${thoughtNumber + 1}). ${uncertainties ? "Resolve the unknowns listed above first." : "Refine the plan or proceed to action."}`);
    } else if (conclusion) {
      lines.push(`✅ CONCLUSION: ${conclusion}`);
      lines.push("");
      lines.push(`→ EXECUTE: Proceed with the action plan above. Start with step 1.`);
    } else {
      lines.push(`✅ STRATEGY FINALIZED. Proceed to execution.`);
    }
    
    return lines.join("\n");
  },
};
