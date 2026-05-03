import { llm } from "@/lib/llm";
import { tavily } from "@/lib/tools/web-search";
import { sandbox } from "@/lib/tools/sandbox";
import {
  saveMemory,
  readMemory,
  getRecentMemories,
} from "@/lib/db";
import {
  searchKnowledge,
  buildKnowledgeContext,
} from "@/lib/db/knowledge";

// ── Tool Types ──

export interface ToolParamDef {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParamDef>;
  execute: (params: Record<string, any>, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
  slackUserId?: string;
  runId?: string;
  taskId?: string;
  workspaceId?: string;  // needed for integration tools
}

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
}

// ── Tool Definitions ──

const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Search the web for real-time information. Use this when you need current data, facts, news, or research on any topic.",
  parameters: {
    query: { type: "string", description: "The search query", required: true },
    max_results: {
      type: "number",
      description: "Number of results to return (1-10, default 5)",
    },
  },
  async execute(params, _ctx) {
    const results = await tavily.search(params.query, params.max_results || 5);
    if (results.length === 0) return "No results found.";
    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`)
      .join("\n\n");
  },
};

const webReadTool: ToolDefinition = {
  name: "web_read",
  description:
    "Read and extract text content from a web page URL. Use this after web_search to get deeper information from specific pages.",
  parameters: {
    url: { type: "string", description: "The URL to read", required: true },
  },
  async execute(params, _ctx) {
    const result = await sandbox({ type: "web_read", url: params.url });
    if (!result.success) return `Failed to read page: ${result.error || "Unknown error"}`;
    return `Title: ${result.content ? "" : "N/A"}\n\n${result.content || "No content extracted."}`;
  },
};

const codeExecuteTool: ToolDefinition = {
  name: "code_execute",
  description:
    "Execute Python or JavaScript code in a secure sandbox. Use this for calculations, data processing, testing, or generating files.",
  parameters: {
    code: { type: "string", description: "The code to execute", required: true },
    language: {
      type: "string",
      description: "Programming language: 'python' or 'javascript' (default: python)",
    },
  },
  async execute(params, _ctx) {
    const result = await sandbox({
      type: "code",
      code: params.code,
      language: params.language || "python",
    });
    const parts: string[] = [];
    if (result.stdout) parts.push(`STDOUT:\n${result.stdout}`);
    if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
    if (result.error) parts.push(`ERROR: ${result.error}`);
    if (result.output_file)
      parts.push(`OUTPUT_FILE generated: ${result.filename || "sandbox-output"}`);
    return parts.length > 0 ? parts.join("\n\n") : "Code executed with no output.";
  },
};

const memorySaveTool: ToolDefinition = {
  name: "memory_save",
  description:
    "Save information to your long-term memory about the user. Use this to remember preferences, project details, or important context for future conversations.",
  parameters: {
    content: {
      type: "string",
      description: "The information to remember (max 1000 chars)",
      required: true,
    },
    category: {
      type: "string",
      description:
        "Category: 'general', 'preference', 'project', 'research', 'interaction'",
    },
  },
  async execute(params, ctx) {
    if (!ctx.slackUserId) return "Cannot save memory: no user context.";
    await saveMemory(
      ctx.slackUserId,
      params.content.slice(0, 1000),
      params.category || "general"
    );
    return `Saved to memory [${params.category || "general"}]: ${params.content.slice(0, 100)}`;
  },
};

const memorySearchTool: ToolDefinition = {
  name: "memory_search",
  description:
    "Search your stored memory about the user. Use this to recall past preferences, project details, or context from previous conversations.",
  parameters: {
    query: {
      type: "string",
      description: "What to search for in memory",
      required: true,
    },
  },
  async execute(params, ctx) {
    if (!ctx.slackUserId) return "Cannot search memory: no user context.";
    const results = await readMemory(ctx.slackUserId, params.query);
    if (results.length === 0) return "No matching memories found.";
    return results
      .map((r: any) => `[${r.category}] ${r.content}`)
      .join("\n");
  },
};

const knowledgeSearchTool: ToolDefinition = {
  name: "knowledge_search",
  description:
    "Search the structured knowledge graph for entities (projects, people, events, standing items). Use this to recall factual information about the user's world.",
  parameters: {
    query: {
      type: "string",
      description: "Entity name or keyword to search for",
      required: true,
    },
  },
  async execute(params, ctx) {
    if (!ctx.slackUserId) return "Cannot search knowledge: no user context.";
    const context = await buildKnowledgeContext(ctx.slackUserId);
    if (!context) return "No knowledge entries found.";
    return context;
  },
};

// ── Integration Tools (require workspaceId in context) ──

function requireWorkspace(ctx: ToolContext): string {
  if (!ctx.workspaceId) throw new Error("No workspace context — integration tools require a connected workspace.");
  return ctx.workspaceId;
}

function integrationError(provider: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `${provider} error: ${msg}`;
}

const googleDriveSearchTool: ToolDefinition = {
  name: "google_drive_search",
  description: "Search for files in Google Drive. Use this to find documents, spreadsheets, or any files stored in the connected Google Drive.",
  parameters: {
    query: { type: "string", description: "Search query for files", required: true },
  },
  async execute(params, ctx) {
    try {
      const { googleDriveSearch } = await import("@/lib/integrations/clients");
      const files = await googleDriveSearch(requireWorkspace(ctx), params.query);
      if (files.length === 0) return "No files found in Google Drive matching your query.";
      return files.map((f: Record<string, unknown>) => `- ${f.name} (${f.type}) ${f.url ? `→ ${f.url}` : ""} [modified: ${f.modifiedAt}]`).join("\n");
    } catch (err) { return integrationError("Google Drive", err); }
  },
};

const googleDriveReadTool: ToolDefinition = {
  name: "google_drive_read",
  description: "Read a file from Google Drive by its ID. Works best with Google Docs and Sheets — exports to text/CSV format.",
  parameters: {
    file_id: { type: "string", description: "The Google Drive file ID", required: true },
  },
  async execute(params, ctx) {
    try {
      const { googleDriveExportDoc, googleDriveExportSheet } = await import("@/lib/integrations/clients");
      const wsId = requireWorkspace(ctx);
      // Try doc first, then sheet
      try {
        const doc = await googleDriveExportDoc(wsId, params.file_id);
        return `Document content:\n${doc.content}`;
      } catch {
        const sheet = await googleDriveExportSheet(wsId, params.file_id);
        return `Spreadsheet content (CSV):\n${sheet.content}`;
      }
    } catch (err) { return integrationError("Google Drive", err); }
  },
};

const githubSearchTool: ToolDefinition = {
  name: "github_search",
  description: "Search for code, repositories, or issues on GitHub. Use this to find code examples, repos, or specific issues in the connected GitHub account.",
  parameters: {
    query: { type: "string", description: "GitHub search query (e.g. 'react hooks' or 'repo:owner/name')", required: true },
  },
  async execute(params, ctx) {
    try {
      const { githubSearchCode } = await import("@/lib/integrations/clients");
      const results = await githubSearchCode(requireWorkspace(ctx), params.query);
      if (results.length === 0) return "No code results found on GitHub.";
      return results.map((r: Record<string, unknown>) => `- ${r.path} in ${r.repository} → ${r.url}`).join("\n");
    } catch (err) { return integrationError("GitHub", err); }
  },
};

const githubReadFileTool: ToolDefinition = {
  name: "github_read_file",
  description: "Read the contents of a file from a GitHub repository. Use this to read source code, configs, READMEs, etc.",
  parameters: {
    owner: { type: "string", description: "Repository owner", required: true },
    repo: { type: "string", description: "Repository name", required: true },
    path: { type: "string", description: "File path within the repo", required: true },
  },
  async execute(params, ctx) {
    try {
      const { githubReadFile } = await import("@/lib/integrations/clients");
      const result = await githubReadFile(requireWorkspace(ctx), params.owner, params.repo, params.path);
      return `File: ${params.owner}/${params.repo}/${params.path}\n\n${result.content}`;
    } catch (err) { return integrationError("GitHub", err); }
  },
};

const githubIssuesTool: ToolDefinition = {
  name: "github_list_issues",
  description: "List issues from a GitHub repository. Use this to see open/closed issues and their details.",
  parameters: {
    owner: { type: "string", description: "Repository owner", required: true },
    repo: { type: "string", description: "Repository name", required: true },
    state: { type: "string", description: "Issue state: 'open' or 'closed' (default: open)" },
  },
  async execute(params, ctx) {
    try {
      const { githubListIssues } = await import("@/lib/integrations/clients");
      const issues = await githubListIssues(requireWorkspace(ctx), params.owner, params.repo, params.state || "open");
      if (issues.length === 0) return `No ${params.state || "open"} issues found.`;
      return issues.map((i: Record<string, unknown>) => `#${i.number} ${i.title} [${i.state}] ${i.url} ${Array.isArray(i.labels) && i.labels.length > 0 ? `labels: ${(i.labels as unknown[]).join(", ")}` : ""}`).join("\n");
    } catch (err) { return integrationError("GitHub", err); }
  },
};



// ── Tool Registry ──

export const allTools: ToolDefinition[] = [
  webSearchTool,
  webReadTool,
  codeExecuteTool,
  memorySaveTool,
  memorySearchTool,
  knowledgeSearchTool,
  // Integration tools
  googleDriveSearchTool,
  googleDriveReadTool,
  githubSearchTool,
  githubReadFileTool,
  githubIssuesTool,
];

export function getToolsByName(names: string[]): ToolDefinition[] {
  return names
    .map((name) => allTools.find((t) => t.name === name))
    .filter((t): t is ToolDefinition => !!t);
}

/** Tools available to the General Agent (conversational, broad) */
export const generalAgentTools: ToolDefinition[] = [
  webSearchTool,
  webReadTool,
  memorySaveTool,
  memorySearchTool,
  knowledgeSearchTool,
];

/** Tools available to the PM Agent (research for specs) */
export const pmAgentTools: ToolDefinition[] = [webSearchTool];

/** Tools available to the Research Agent (deep research) */
export const researchAgentTools: ToolDefinition[] = [
  webSearchTool,
  webReadTool,
];

/** Tools available to the Analyst Agent (code execution) */
export const analystAgentTools: ToolDefinition[] = [codeExecuteTool];

// ── Tool Description Formatter ──

export function formatToolDescriptions(tools: ToolDefinition[]): string {
  if (tools.length === 0) return "";

  const lines = tools.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `  - "${k}" (${v.type}${v.required ? ", required" : ""}): ${v.description}`)
      .join("\n");
    return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
  });

  return `\n\nAVAILABLE TOOLS:\nYou have access to these tools. When you need to use one, respond with EXACTLY this format:\n[TOOL:tool_name]{"param": "value"}[/TOOL]\n\nYou may use multiple tools in one response (one [TOOL] block per tool).\nAfter receiving tool results, you can use more tools or provide your final answer.\n\n${lines.join("\n\n")}`;
}
