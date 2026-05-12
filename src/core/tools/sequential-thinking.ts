import { ToolDefinition } from "./registry";

/**
 * Sequential Thinking Tool
 * 
 * Provides a structured way for agents to process complex tasks,
 * evaluate performance trade-offs, and maintain a stateful reasoning chain.
 * This tool is designed to prevent "jumping to conclusions" and enforces
 * the selection of the fastest/leanest tools (Polars, lxml, etc.).
 */

export const sequentialThinkingTool: ToolDefinition = {
  name: "sequential_thinking",
  description: "MANDATORY FIRST STEP: A tool for structured reasoning and strategic planning. You MUST use this tool FIRST for any complex, multi-step, or ambiguous request before using any other tool. Use this to break down the request, evaluate performance trade-offs, and select the fastest/simplest approach. Record your step-by-step strategy here.",
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
      description: "Estimated total number of thoughts needed",
      required: true,
    },
    nextThoughtNeeded: {
      type: "boolean",
      description: "Whether another thought step is required before action",
      required: true,
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
    const { thought, thoughtNumber, totalThoughts, nextThoughtNeeded, strategy, isRevision, revisesThought, branchFromThought } = params;
    
    let output = `[THOUGHT ${thoughtNumber}/${totalThoughts}]`;
    if (isRevision) {
      output += ` (Revising thought ${revisesThought})`;
    }
    if (branchFromThought) {
      output += ` (Branching from thought ${branchFromThought})`;
    }
    output += `\n${thought}`;
    
    if (strategy) {
      output += `\n\n🎯 SELECTED STRATEGY: ${strategy}`;
    }
    
    if (nextThoughtNeeded) {
      output += `\n\n(Waiting for next thought step...)`;
    } else {
      output += `\n\n✅ STRATEGY FINALIZED. Proceeding to execution.`;
    }
    
    return output;
  },
};
