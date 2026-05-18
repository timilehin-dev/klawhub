import { llm } from "@/core/llm";
import { tavily } from "@/core/tools/web-search";
import { sandbox } from "@/core/tools/sandbox";
import { dispatchTaskTool, dispatchWorkflowTool } from "@/core/tools/implementations/dispatch";
import { mcpConnectTool, mcpListTool, mcpRemoveTool } from "@/core/tools/implementations/mcp";
export { mcpConnectTool, mcpListTool, mcpRemoveTool };
import {
  saveMemory,
  readMemory,
  getRecentMemories,
  getWebhookByName,
  decryptWebhookHeaders,
  createSchedule,
  deleteSchedule,
  schedules,
  pendingActions,
  getDb,
} from "@/db";
import {
  searchKnowledge,
  searchDocumentChunks,
} from "@/db/knowledge";
import { slack, postToThread } from "@/integrations/slack/client";
import { githubUpdateFile, githubCreatePullRequest } from "@/integrations/clients";
import { sequentialThinkingTool } from "./sequential-thinking";

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
  workspaceId?: string;
  slackUserId?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  runId?: string;
  taskId?: string;
  slackTeamId?: string;
  isApproved?: boolean; // Set to true when resuming an approved tool call
  pendingActionId?: string;
}

// ── HITL Helper ──

function hashParams(toolName: string, params: any): string {
  const str = JSON.stringify({ toolName, params }, Object.keys({ toolName, params }).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

async function requestHumanApproval(toolName: string, params: any, ctx: ToolContext) {
  const db = getDb();
  const workspaceId = requireWorkspace(ctx);
  const paramHash = hashParams(toolName, params);
  
  // Check if already approved
  const existing = await db.select().from(pendingActions).where(
    require("drizzle-orm").and(
      require("drizzle-orm").eq(pendingActions.workspaceId, workspaceId),
      require("drizzle-orm").eq(pendingActions.toolName, toolName),
      require("drizzle-orm").eq(pendingActions.status, "approved")
    )
  );
  
  // Filter for same params (hash collision check)
  const approved = existing.find(a => hashParams(a.toolName, a.params) === paramHash);
  if (approved) return null; // Approved! Proceed.

  if (!ctx.slackUserId || !ctx.slackChannelId) {
    throw new Error(`Cannot request approval for "${toolName}": Missing user or channel context.`);
  }

  const [action] = await db.insert(pendingActions).values({
    workspaceId: workspaceId,
    slackUserId: ctx.slackUserId,
    slackChannelId: ctx.slackChannelId,
    toolName,
    params,
    status: "pending",
  }).returning();

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🛡️ *Action Approval Required*\nAn agent wants to perform a sensitive operation: \`${toolName}\`\n\n*Parameters:*\n\`\`\`${JSON.stringify(params, null, 2)}\`\`\``,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "tool_approve",
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          value: action.id,
        },
        {
          type: "button",
          action_id: "tool_reject",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          value: action.id,
        },
      ],
    },
  ];

  await postToThread(ctx.slackChannelId || "", ctx.slackThreadTs || "", "I need your approval for a GitHub write operation.", { blocks });

  return `[PENDING_APPROVAL] This action requires your approval in Slack. I have sent an approval request to the thread. Once you approve it, please tell me to "continue" or "retry".`;
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
    "Read and extract text content from a web page URL. Use this after web_search to get deeper information from specific pages. Falls back to browser if the sandbox is unavailable.",
  parameters: {
    url: { type: "string", description: "The URL to read", required: true },
  },
  async execute(params, _ctx) {
    // Try sandbox first, then fall back to browser
    const modalUrl = process.env.MODAL_FUNCTION_URL;
    if (modalUrl) {
      const result = await sandbox({ type: "web_read", url: params.url });
      if (result.success && result.content) {
        return `Title: ${result.content ? "" : "N/A"}\n\n${result.content}`;
      } else if (!result.success) {
        console.warn(`[WEB_READ] Sandbox failed: ${result.error || "Unknown error"}. Attempting browser fallback.`);
      }
    }

    try {
      const { browseUrl, isBrowserConfigured } = await import("@/integrations/browser/actions");
      if (!isBrowserConfigured()) {
        return `Failed to read page: ${params.url}. Neither sandbox nor browser automation is configured. Please set MODAL_FUNCTION_URL or BROWSER_WS_URL.`;
      }
      return await browseUrl(params.url);
    } catch (err) {
      return `Failed to read page: ${params.url}. Browser fallback failed: ${(err as Error).message.slice(0, 300)}.`;
    }
  },
};

const codeExecuteTool: ToolDefinition = {
  name: "code_execute",
  description:
    "Execute Python or JavaScript code in a secure sandbox. Use this for calculations, data processing, testing, or generating files. Requires the sandbox service to be configured.",
  parameters: {
    code: { type: "string", description: "The code to execute", required: true },
    language: {
      type: "string",
      description: "Programming language: 'python' or 'javascript' (default: python)",
    },
  },
  async execute(params, _ctx) {
    if (!process.env.MODAL_FUNCTION_URL) {
      return "Code execution is not available — sandbox service is not configured. Ask the workspace admin to set MODAL_FUNCTION_URL.";
    }
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

const parseDocumentTool: ToolDefinition = {
  name: "parse_document",
  description:
    "Parse and extract text and structured tabular data from a PDF, Word document (DOCX), text file, CSV, JSON, XML, or spreadsheet. Executes in a secure isolated sandbox.",
  parameters: {
    file_b64: { type: "string", description: "Base64-encoded file content", required: true },
    filename: { type: "string", description: "Name of the file including extension (e.g. invoice.pdf)", required: true },
  },
  async execute(params, _ctx) {
    if (!process.env.MODAL_FUNCTION_URL) {
      return "Document parsing is not available — sandbox service is not configured.";
    }
    const result = await sandbox({
      type: "parse_document",
      file: params.file_b64,
      filename: params.filename,
    });
    if (!result.success) {
      return `Failed to parse document: ${result.error || "Unknown sandbox error"}`;
    }
    return `Document successfully parsed.\n\nParsed Content:\n${result.text}`;
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
      params.category || "general",
      ctx.workspaceId
    );
    return `Saved to memory [${params.category || "general"}]: ${params.content.slice(0, 100)}... (truncated for display)`;
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
    const results = await readMemory(ctx.slackUserId, params.query, ctx.workspaceId);
    if (results.length === 0) return "No matching memories found.";
    return results
      .map((r: any) => `[${r.category}] ${r.content}`)
      .join("\n");
  },
};

const knowledgeSearchTool: ToolDefinition = {
  name: "knowledge_search",
  description:
    "Search the structured knowledge base. Use this to recall projects, people, and specific details from indexed documents or Slack threads.",
  parameters: {
    query: {
      type: "string",
      description: "Search query or keyword",
      required: true,
    },
  },
  async execute(params, ctx) {
    if (!ctx.slackUserId || !ctx.workspaceId) return "Cannot search knowledge: missing context.";
    
    const [entities, chunks] = await Promise.all([
        searchKnowledge(ctx.slackUserId, params.query, ctx.workspaceId),
        searchDocumentChunks(ctx.workspaceId, params.query, 5)
    ]);

    let output = "";

    if (entities.length > 0) {
        output += "── Structured Knowledge ──\n";
        output += entities.map((k: any) => {
            const dataStr = Object.entries(k.data as Record<string, unknown>)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([key, val]) => `${key}: ${val}`)
              .join(", ");
            return `[${k.entityType}] ${k.entityName}: ${dataStr}`;
          }).join("\n") + "\n\n";
    }

    if (chunks.length > 0) {
        output += "── Relevant Document Excerpts ──\n";
        output += chunks.map((c: any) => `[Source: ${c.sourceType}] ${c.content}`).join("\n\n");
    }

    return output || "No matching knowledge or document excerpts found.";
  },
};

const knowledgeIndexResourceTool: ToolDefinition = {
  name: "knowledge_index_resource",
  description: "Index a Slack thread or Google Drive file into the knowledge base for long-term memory. Use this to explicitly 'save' a conversation or document.",
  parameters: {
    resource_id: { type: "string", description: "The ID of the resource (thread_ts for Slack, file_id for GDrive)", required: true },
    resource_type: { type: "string", description: "Type: 'slack_thread' or 'gdrive_file'", required: true },
    filename: { type: "string", description: "Optional filename for display" },
    channel_id: { type: "string", description: "Slack channel ID (required if indexing a thread)" },
  },
  async execute(params, ctx) {
    const wsId = requireWorkspace(ctx);
    const { inngest } = await import("@/workflows/client");
    
    await inngest.send({
      name: "knowledge/index.requested",
      data: {
        type: params.resource_type,
        workspaceId: wsId,
        resourceId: params.resource_id,
        slackUserId: ctx.slackUserId,
        teamId: ctx.slackTeamId,
        metadata: {
          channelId: params.channel_id || ctx.slackChannelId,
          filename: params.filename,
        }
      }
    });

    return `Indexing job dispatched for ${params.resource_type}. This happens in the background. I'll remember this content shortly.`;
  },
};

// ── Integration Tools (require workspaceId in context) ──

function requireWorkspace(ctx: ToolContext): string {
  if (!ctx.workspaceId) throw new Error("No workspace context — integration tools require a connected workspace. The workspace connection may not be set up yet.");
  return ctx.workspaceId;
}

function integrationError(provider: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("not connected") || msg.includes("No workspace context")) {
    return `${provider} is not connected. Ask the user to connect it from the dashboard at https://klawhub.com/dashboard/integrations`;
  }
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
      const { googleDriveSearch } = await import("@/integrations/clients");
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
      const { googleDriveExportDoc, googleDriveExportSheet } = await import("@/integrations/clients");
      const wsId = requireWorkspace(ctx);
      // Try doc first, then sheet
      try {
        const doc = await googleDriveExportDoc(wsId, params.file_id);
        return `Document content:\n${doc.content}`;
      } catch (docErr) {
        // If doc export fails, try sheet export. Log doc error for debugging.
        const docErrMsg = docErr instanceof Error ? docErr.message : String(docErr);
        console.warn(`[GoogleDrive] Failed to export as document: ${docErrMsg}. Trying as spreadsheet.`);
        try {
          const sheet = await googleDriveExportSheet(wsId, params.file_id);
          return `Spreadsheet content (CSV):\n${sheet.content}`;
        } catch (sheetErr) {
          // If both fail, report both errors or the most relevant one.
          const sheetErrMsg = sheetErr instanceof Error ? sheetErr.message : String(sheetErr);
          throw new Error(`Failed to read Google Drive file as document or spreadsheet. Document error: ${docErrMsg}. Spreadsheet error: ${sheetErrMsg}`);
        }
      }
    } catch (err) { return integrationError("Google Drive", err); }
  },
};

const gmailSendEmailTool: ToolDefinition = {
  name: "gmail_send_email",
  description: "Send an email via Gmail from the connected Google Workspace account. Best for sending client invoices, team briefings, and system alerts.",
  parameters: {
    to: { type: "string", description: "Recipient email address", required: true },
    subject: { type: "string", description: "Email subject line", required: true },
    body: { type: "string", description: "Email body content (HTML or plain text)", required: true },
  },
  async execute(params, ctx) {
    try {
      const { gmailSendEmail } = await import("@/integrations/clients");
      await gmailSendEmail(requireWorkspace(ctx), params.to, params.subject, params.body);
      return `Email successfully sent to ${params.to} with subject "${params.subject}".`;
    } catch (err) { return integrationError("Gmail", err); }
  },
};

const gmailListMessagesTool: ToolDefinition = {
  name: "gmail_list_messages",
  description: "List recent emails from the connected Gmail account. Use to monitor and extract customer requests, invoices, or feedback.",
  parameters: {
    max_results: { type: "number", description: "Maximum number of emails to retrieve (default 5, max 10)" },
    query: { type: "string", description: "Search query or filter (e.g. 'from:example@domain.com' or 'subject:invoice')" },
  },
  async execute(params, ctx) {
    try {
      const { gmailListMessages } = await import("@/integrations/clients");
      const messages = await gmailListMessages(requireWorkspace(ctx), params.max_results || 5, params.query);
      if (messages.length === 0) return "No emails found matching your query.";
      return messages.map((m: any) => `- ID: ${m.id}\n  From: ${m.from}\n  Subject: ${m.subject}\n  Date: ${m.date}\n  Snippet: ${m.snippet}`).join("\n\n");
    } catch (err) { return integrationError("Gmail", err); }
  },
};

const githubListReposTool: ToolDefinition = {
  name: "github_list_repos",
  description: "List all GitHub repositories accessible via the connected account. Use this to see what projects are available, their full names, and when they were last updated.",
  parameters: {},
  async execute(params, ctx) {
    try {
      const { githubListRepos } = await import("@/integrations/clients");
      const repos = await githubListRepos(requireWorkspace(ctx));
      if (repos.length === 0) return "No GitHub repositories found.";
      return repos.map((r: any) => `- **${r.name}**\n  URL: ${r.url}\n  Lang: ${r.language || "N/A"} | Stars: ${r.stars} | Updated: ${r.updatedAt}`).join("\n\n");
    } catch (err) { return integrationError("GitHub", err); }
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
      const { githubSearchCode } = await import("@/integrations/clients");
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
      const { githubReadFile } = await import("@/integrations/clients");
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
      const { githubListIssues } = await import("@/integrations/clients");
      const issues = await githubListIssues(requireWorkspace(ctx), params.owner, params.repo, params.state || "open");
      if (issues.length === 0) return `No ${params.state || "open"} issues found.`;
      return issues.map((i: Record<string, unknown>) => `#${i.number} ${i.title} [${i.state}] ${i.url} ${Array.isArray(i.labels) && i.labels.length > 0 ? `labels: ${(i.labels as unknown[]).join(", ")}` : ""}`).join("\n");
    } catch (err) { return integrationError("GitHub", err); }
  },
};

const githubUpdateFileTool: ToolDefinition = {
  name: "github_update_file",
  description: "Update the content of an existing file in a GitHub repository. REQUIRES HUMAN APPROVAL. You must provide the file path, new content, and a commit message.",
  parameters: {
    owner: { type: "string", description: "Repository owner", required: true },
    repo: { type: "string", description: "Repository name", required: true },
    path: { type: "string", description: "File path within the repo", required: true },
    content: { type: "string", description: "The new file content", required: true },
    message: { type: "string", description: "Commit message", required: true },
    sha: { type: "string", description: "Optional current file SHA (recommended to prevent conflicts)" },
  },
  async execute(params, ctx) {
    const approvalRequired = await requestHumanApproval("github_update_file", params, ctx);
    if (approvalRequired) return approvalRequired;

    const result = await githubUpdateFile(
      requireWorkspace(ctx),
      params.owner,
      params.repo,
      params.path,
      params.content,
      params.message,
      params.sha
    );
    return `Successfully updated file: ${params.path}\nURL: ${result.content?.html_url || "N/A"}`;
  },
};

const githubCreatePullRequestTool: ToolDefinition = {
  name: "github_create_pull_request",
  description: "Create a new pull request in a GitHub repository. REQUIRES HUMAN APPROVAL. You must provide the PR title, head branch, and base branch.",
  parameters: {
    owner: { type: "string", description: "Repository owner", required: true },
    repo: { type: "string", description: "Repository name", required: true },
    title: { type: "string", description: "PR title", required: true },
    head: { type: "string", description: "The name of the branch where your changes are implemented", required: true },
    base: { type: "string", description: "The name of the branch you want the changes pulled into (e.g., main)", required: true },
    body: { type: "string", description: "PR description body" },
  },
  async execute(params, ctx) {
    const { githubCreatePullRequest } = await import("@/integrations/clients");
    const approvalRequired = await requestHumanApproval("github_create_pull_request", params, ctx);
    if (approvalRequired) return approvalRequired;

    const result = await githubCreatePullRequest(
      requireWorkspace(ctx),
      params.owner,
      params.repo,
      params.title,
      params.head,
      params.base,
      params.body
    );
    return `Successfully created pull request: ${params.title}\nURL: ${result.html_url}`;
  },
};

// ── Browser Automation Tools (require BROWSER_WS_URL env var) ──

const browserBrowseTool: ToolDefinition = {
  name: "browser_browse",
  description: "Open a URL in a headless browser and extract the visible text content. Use this for dynamic pages, SPAs, or sites that require JavaScript rendering — where web_read fails.",
  parameters: {
    url: { type: "string", description: "The URL to browse", required: true },
  },
  async execute(params, _ctx) {
    try {
      const { browseUrl } = await import("@/integrations/browser/actions");
      return await browseUrl(params.url);
    } catch (err) { return `Browser error: ${(err as Error).message.slice(0, 300)}`; }
  },
};

const browserScrapeTool: ToolDefinition = {
  name: "browser_scrape",
  description: "Scrape structured text from a web page using CSS selectors. Opens the page in a browser, waits for it to load, then extracts text from specific elements.",
  parameters: {
    url: { type: "string", description: "The URL to scrape", required: true },
    selector: { type: "string", description: "CSS selector to extract text from (e.g. 'table.data', '.article-body', '#results'). If omitted, extracts full page text." },
  },
  async execute(params, _ctx) {
    try {
      const { browserScrape } = await import("@/integrations/browser/actions");
      return await browserScrape(params.url, params.selector);
    } catch (err) { return `Browser scrape error: ${(err as Error).message.slice(0, 300)}`; }
  },
};

const browserLinksTool: ToolDefinition = {
  name: "browser_links",
  description: "Extract all links (anchor tags) from a web page. Returns the link text and URL for each link found.",
  parameters: {
    url: { type: "string", description: "The URL to extract links from", required: true },
  },
  async execute(params, _ctx) {
    try {
      const { browserGetLinks } = await import("@/integrations/browser/actions");
      return await browserGetLinks(params.url);
    } catch (err) { return `Browser links error: ${(err as Error).message.slice(0, 300)}`; }
  },
};

const browserInteractTool: ToolDefinition = {
  name: "browser_interact",
  description: "Interact with a web page: navigate, click buttons, type text, select dropdowns, wait for elements, and scrape results. For multi-step browser workflows like form submissions, logins, or navigating multi-page flows.",
  parameters: {
    url: { type: "string", description: "Starting URL", required: true },
    actions: { type: "string", description: 'JSON array of actions: [{"type":"click","selector":"button.submit"},{"type":"type","selector":"#email","value":"user@example.com"},{"type":"select","selector":"#country","value":"US"},{"type":"wait","selector":".results"},{"type":"scrape"}]', required: true },
  },
  async execute(params, _ctx) {
    try {
      const { browserInteract } = await import("@/integrations/browser/actions");
      const actions = JSON.parse(params.actions);
      return await browserInteract(params.url, actions);
    } catch (err) {
      if ((err as Error).message.includes("JSON")) return "Invalid actions JSON. Must be an array of {type, selector?, value?} objects.";
      return `Browser interact error: ${(err as Error).message.slice(0, 300)}`;
    }
  },
};

const browserScreenshotTool: ToolDefinition = {
  name: "browser_screenshot",
  description: "Take a screenshot of a web page. Returns metadata about the PNG capture (viewport, full-page, or element). The screenshot is uploaded to Slack automatically when used in a workflow.",
  parameters: {
    url: { type: "string", description: "The URL to screenshot", required: true },
    full_page: { type: "boolean", description: "Capture the entire scrollable page (default: false, just viewport)" },
    selector: { type: "string", description: "CSS selector to screenshot a specific element instead of the full page" },
  },
  async execute(params, _ctx) {
    try {
      const { browserScreenshot } = await import("@/integrations/browser/actions");
      const buffer = await browserScreenshot(params.url, {
        fullPage: params.full_page || false,
        selector: params.selector,
      });
      if (!buffer) return "Browser is not available. Set BROWSER_WS_URL to enable screenshots.";
      // Store buffer for upload — return metadata
      const bytes = buffer.length;
      const base64 = buffer.toString("base64");
      // Return base64 so the caller can upload to Slack
      return `[SCREENSHOT_OK] ${bytes} bytes PNG captured.\n[SCREENSHOT_BASE64] ${base64.slice(0, 100)}...(truncated, full base64 available)`;
    } catch (err) { return `Screenshot error: ${(err as Error).message.slice(0, 300)}`; }
  },
};



const webhookCustomRequestTool: ToolDefinition = {
  name: "webhook_custom_request",
  description: "Query a user-specified HTTP endpoint or dispatch a request via a saved custom webhook name. Authorization and secret headers are decrypted securely at rest.",
  parameters: {
    webhook_name: { type: "string", description: "Optional name of a saved webhook configuration to use (e.g., 'Stripe', 'HubSpot'). If omitted, 'url' parameter must be provided." },
    url: { type: "string", description: "Optional target URL for the custom HTTP request. Required if webhook_name is not provided." },
    method: { type: "string", description: "HTTP method to use (GET, POST, PUT, DELETE, PATCH). Default is POST." },
    body: { type: "string", description: "Optional JSON string or plain text body to send with POST, PUT, or PATCH requests." },
    headers: { type: "string", description: "Optional dynamic request headers to send as a JSON-serialized string." },
  },
  async execute(params, ctx) {
    try {
      const wsId = requireWorkspace(ctx);
      let targetUrl = params.url;
      let targetMethod = (params.method || "POST").toUpperCase();
      const finalHeaders: Record<string, string> = { "Content-Type": "application/json" };

      if (params.webhook_name) {
        const wh = await getWebhookByName(wsId, params.webhook_name);
        if (!wh) {
          return `Error: Stored webhook with name "${params.webhook_name}" was not found in this workspace. Let the user know to configure it first.`;
        }
        const storedHeaders = decryptWebhookHeaders(wh.headersEncrypted);
        Object.assign(finalHeaders, storedHeaders);
        if (!targetUrl) targetUrl = wh.url;
        if (!params.method) targetMethod = wh.method.toUpperCase();
      }

      if (params.headers) {
        try {
          const parsedDynamic = JSON.parse(params.headers);
          Object.assign(finalHeaders, parsedDynamic);
        } catch {
          return `Error: Failed to parse headers parameter as valid JSON. Received: ${params.headers}`;
        }
      }

      if (!targetUrl) {
        return "Error: Missing target URL. Please provide either a valid 'url' parameter or a saved 'webhook_name' that contains a URL.";
      }

      const fetchOptions: RequestInit = {
        method: targetMethod,
        headers: finalHeaders,
      };

      if (params.body && ["POST", "PUT", "PATCH", "DELETE"].includes(targetMethod)) {
        fetchOptions.body = params.body;
      }

      const response = await fetch(targetUrl, fetchOptions);
      let responseText: string;
      try {
        responseText = await response.text();
      } catch (e) {
        console.warn(`[WEBHOOK] Failed to read response text from ${targetUrl}:`, e);
        responseText = `(Failed to read response body: ${(e as Error).message})`;
      }

      return `Custom HTTP request complete.\nStatus: ${response.status} ${response.statusText}\nTarget URL: ${targetUrl}\nMethod: ${targetMethod}\n\nResponse Content (truncated to 1000 chars):\n${responseText.slice(0, 1000)}`;
    } catch (err) {
      return `Custom HTTP request failed: ${(err as Error).message}`;
    }
  },
};

const resendSendEmailTool: ToolDefinition = {
  name: "resend_send_email",
  description: "Send a transactional email using the lightweight Resend engine. Best for summaries, status updates, client alerts, and standard notifications.",
  parameters: {
    to: { type: "string", description: "The recipient's email address.", required: true },
    subject: { type: "string", description: "The subject line of the email.", required: true },
    body: { type: "string", description: "The body content of the email (HTML supported).", required: true },
  },
  async execute(params, ctx) {
    try {
      const { resendSendEmail } = await import("@/integrations/resend");
      await resendSendEmail(params.to, params.subject, params.body);
      return `Successfully dispatched email to ${params.to} with subject: "${params.subject}" via Resend.`;
    } catch (err) {
      return `Resend email dispatch failed: ${(err as Error).message}`;
    }
  },
};
const googleCalendarListEventsTool: ToolDefinition = {
  name: "google_calendar_list_events",
  description: "Retrieve upcoming meetings and agendas from the connected Google Calendar. Use this to prepare documentation, meeting briefings, or agendas.",
  parameters: {
    max_results: { type: "number", description: "Maximum number of events to fetch. Default is 5, max is 15." },
  },
  async execute(params, ctx) {
    try {
      const wsId = requireWorkspace(ctx);
      const { googleCalendarListEvents } = await import("@/integrations/clients");
      const events = await googleCalendarListEvents(wsId, { maxResults: params.max_results || 5 });

      if (events.length === 0) {
        return "No upcoming Google Calendar events found.";
      }

      const formatted = events.map((e: any) => {
        const startStr = new Date(e.start).toLocaleString();
        const endStr = new Date(e.end).toLocaleString();
        const desc = e.description ? `\n  Description: ${e.description}` : "";
        const loc = e.location ? `\n  Location: ${e.location}` : "";
        const att = e.attendees.length > 0 ? `\n  Attendees: ${e.attendees.join(", ")}` : "";
        return `- **${e.summary}**\n  Time: ${startStr} - ${endStr}${loc}${desc}${att}\n  Link: ${e.htmlLink}`;
      }).join("\n\n");

      return `Upcoming Google Calendar Events:\n\n${formatted}`;
    } catch (err) {
      return integrationError("Google Calendar", err);
    }
  },
};

const scheduleCreateTool: ToolDefinition = {
  name: "schedule_create",
  description: "Create a new recurring scheduled task (cron). This allows you to schedule any conversational or automated task (e.g. daily standups, channel alerts, periodic check-ins) to execute automatically at specific intervals.",
  parameters: {
    name: { type: "string", description: "Descriptive name for this scheduled task (e.g., 'Daily Standup Call')", required: true },
    cron_expr: { type: "string", description: "Standard 5-field cron expression (e.g., '0 9 * * 1-5' for 9 AM Mon-Fri, '0 9 * * 1' for 9 AM Monday)", required: true },
    action: { type: "string", description: "The exact action or prompt instructions for the agent to execute when triggered (e.g. 'Generate and post a morning huddle check-in')", required: true },
    channel_id: { type: "string", description: "The Slack channel ID where the results/message should be posted", required: true },
    timezone: { type: "string", description: "Timezone for the schedule (e.g., 'America/New_York', 'UTC', 'Europe/London'). Default is 'UTC'." },
  },
  async execute(params, ctx) {
    if (!ctx.slackTeamId) {
      return "Error: Slack Team ID context is missing. Unable to create schedule.";
    }

    try {
      const { isValidCron } = await import("@/utils/cron-validator");
      if (!isValidCron(params.cron_expr)) {
        return `Error: Invalid cron expression '${params.cron_expr}'. Please provide a valid 5-field cron expression.`;
      }

      const [schedule] = await createSchedule({
        slackUserId: ctx.slackUserId || "system",
        slackTeamId: ctx.slackTeamId,
        name: params.name,
        cronExpr: params.cron_expr,
        action: params.action,
        channelId: params.channel_id,
        timezone: params.timezone || "UTC",
        isActive: true,
      });

      return `Successfully created schedule:
ID: ${schedule.id}
Name: ${schedule.name}
Cron: ${schedule.cronExpr} (Timezone: ${schedule.timezone})
Action: ${schedule.action}
Channel ID: ${schedule.channelId}`;
    } catch (err) {
      return `Failed to create schedule: ${(err as Error).message}`;
    }
  }
};

const scheduleListTool: ToolDefinition = {
  name: "schedule_list",
  description: "List all active schedules configured for this workspace. Use this to audit existing automated tasks or find the ID of a schedule you want to manage or delete.",
  parameters: {
    channel_id: { type: "string", description: "Optional Slack channel ID to filter the schedule list to a specific channel" },
  },
  async execute(params, ctx) {
    if (!ctx.slackTeamId) {
      return "Error: Slack Team ID context is missing.";
    }

    try {
      const getDb = (await import("@/db")).getDb;
      const { eq, and } = await import("drizzle-orm");
      
      const conditions = [eq(schedules.slackTeamId, ctx.slackTeamId)];
      if (params.channel_id) {
        conditions.push(eq(schedules.channelId, params.channel_id));
      }

      const list = await getDb()
        .select()
        .from(schedules)
        .where(and(...conditions));

      if (list.length === 0) {
        return "No schedules found in this workspace.";
      }

      const lines = list.map(s => {
        return `• *${s.name}* (ID: \`${s.id}\`)
  Cron: \`${s.cronExpr}\` (${s.timezone || "UTC"}) | Active: ${s.isActive}
  Channel: <#${s.channelId}>
  Action: "${s.action}"`;
      });

      return `Active schedules in this workspace:\n\n${lines.join("\n\n")}`;
    } catch (err) {
      return `Failed to list schedules: ${(err as Error).message}`;
    }
  }
};

const scheduleDeleteTool: ToolDefinition = {
  name: "schedule_delete",
  description: "Delete/cancel an existing scheduled task using its unique schedule ID.",
  parameters: {
    schedule_id: { type: "string", description: "The UUID of the schedule to delete", required: true },
  },
  async execute(params, ctx) {
    try {
      const getDb = (await import("@/db")).getDb;
      const { eq } = await import("drizzle-orm");

      // Verify ownership / same team to prevent cross-tenant deletes
      const existing = await getDb()
        .select()
        .from(schedules)
        .where(eq(schedules.id, params.schedule_id))
        .limit(1);

      if (existing.length === 0) {
        return `Schedule with ID ${params.schedule_id} not found.`;
      }

      if (ctx.slackTeamId && existing[0].slackTeamId !== ctx.slackTeamId) {
        return "Error: You do not have permission to delete this schedule.";
      }

      await deleteSchedule(params.schedule_id);
      return `Successfully deleted schedule: "${existing[0].name}" (ID: ${params.schedule_id}).`;
    } catch (err) {
      return `Failed to delete schedule: ${(err as Error).message}`;
    }
  }
};

const slackListChannelsTool: ToolDefinition = {
  name: "slack_list_channels",
  description: "List all public channels available in the Slack workspace, including their names and IDs. Use this to find the correct channel ID when a user mentions a channel by name (e.g., '#huddles' or '#marketing').",
  parameters: {},
  async execute(params, ctx) {
    if (!ctx.slackTeamId) {
      return "Error: Slack Team ID context is missing.";
    }

    try {
      const { getWorkspaceSlack } = await import("@/integrations/slack/client");
      const wsSlack = await getWorkspaceSlack(ctx.slackTeamId);

      const response = await wsSlack.conversations.list({
        types: "public_channel",
        exclude_archived: true,
        limit: 200,
      });

      const channels = ((response as any).channels || []);
      if (channels.length === 0) {
        return "No public channels found in this workspace.";
      }

      const lines = channels.map((ch: any) => `• *#${ch.name}* (ID: \`${ch.id}\`) ${ch.is_member ? "[Joined]" : ""}`);
      return `Slack channels in this workspace:\n\n${lines.join("\n")}`;
    } catch (err) {
      return `Failed to list Slack channels: ${(err as Error).message}`;
    }
  }
};

const scheduleToggleTool: ToolDefinition = {
  name: "schedule_toggle",
  description: "Pause (deactivate) or resume (activate) an existing scheduled task using its unique schedule ID.",
  parameters: {
    schedule_id: { type: "string", description: "The UUID of the schedule to toggle", required: true },
    active: { type: "boolean", description: "Set to true to activate/resume, or false to deactivate/pause", required: true },
  },
  async execute(params, ctx) {
    try {
      const getDb = (await import("@/db")).getDb;
      const { eq } = await import("drizzle-orm");
      const { updateSchedule } = await import("@/db/schedules");

      // Verify ownership / same team to prevent cross-tenant changes
      const existing = await getDb()
        .select()
        .from(schedules)
        .where(eq(schedules.id, params.schedule_id))
        .limit(1);

      if (existing.length === 0) {
        return `Schedule with ID ${params.schedule_id} not found.`;
      }

      if (ctx.slackTeamId && existing[0].slackTeamId !== ctx.slackTeamId) {
        return "Error: You do not have permission to manage this schedule.";
      }

      await updateSchedule(params.schedule_id, { isActive: params.active });
      const status = params.active ? "activated/resumed" : "deactivated/paused";
      return `Successfully ${status} schedule: "${existing[0].name}" (ID: ${params.schedule_id}).`;
    } catch (err) {
      return `Failed to toggle schedule: ${(err as Error).message}`;
    }
  }
};

const scheduleEditTool: ToolDefinition = {
  name: "schedule_edit",
  description: "Edit/update an existing scheduled task (cron). Use this to change a schedule's time, action, channel, name, or timezone.",
  parameters: {
    schedule_id: { type: "string", description: "The UUID of the schedule to edit", required: true },
    name: { type: "string", description: "New descriptive name (optional)" },
    cron_expr: { type: "string", description: "New cron expression (optional, e.g. '0 9 * * 1-5')" },
    action: { type: "string", description: "New action/prompt instructions (optional)" },
    channel_id: { type: "string", description: "New Slack channel ID (optional)" },
    timezone: { type: "string", description: "New timezone (optional, e.g. 'America/New_York')" },
  },
  async execute(params, ctx) {
    try {
      const getDb = (await import("@/db")).getDb;
      const { eq } = await import("drizzle-orm");
      const { updateSchedule } = await import("@/db/schedules");

      // Verify ownership
      const existing = await getDb()
        .select()
        .from(schedules)
        .where(eq(schedules.id, params.schedule_id))
        .limit(1);

      if (existing.length === 0) {
        return `Schedule with ID ${params.schedule_id} not found.`;
      }

      if (ctx.slackTeamId && existing[0].slackTeamId !== ctx.slackTeamId) {
        return "Error: You do not have permission to edit this schedule.";
      }

      const updates: any = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.cron_expr !== undefined) updates.cronExpr = params.cron_expr;
      if (params.action !== undefined) updates.action = params.action;
      if (params.channel_id !== undefined) updates.channelId = params.channel_id;
      if (params.timezone !== undefined) updates.timezone = params.timezone;

      if (updates.cronExpr !== undefined) {
        const { isValidCron } = await import("@/utils/cron-validator");
        if (!isValidCron(updates.cronExpr)) {
          return `Error: Invalid cron expression '${updates.cronExpr}'. Please provide a valid 5-field cron expression.`;
        }
      }

      if (Object.keys(updates).length === 0) {
        return "No changes provided to update.";
      }

      const [updated] = await updateSchedule(params.schedule_id, updates);
      return `Successfully updated schedule:
ID: ${updated.id}
Name: ${updated.name}
Cron: ${updated.cronExpr} (Timezone: ${updated.timezone})
Action: ${updated.action}
Channel ID: ${updated.channelId}`;
    } catch (err) {
      return `Failed to edit schedule: ${(err as Error).message}`;
    }
  }
};

const scheduleListPresetsTool: ToolDefinition = {
  name: "schedule_list_presets",
  description: "List all high-value schedule 'recipes' or templates available in Klawhub. Use this to suggest useful automations to the user or to quickly find the configuration for a common task.",
  parameters: {},
  async execute() {
    try {
      const { SCHEDULE_PRESETS } = await import("./schedule-presets");
      const lines = SCHEDULE_PRESETS.map(p => {
        return `• *${p.name}* (ID: \`${p.id}\`)
  "${p.description}"
  Recommended: \`${p.cronExpr}\` | Channel: #${p.recommendedChannelName || "general"}`;
      });
      return `Klawhub Automation Recipes:\n\n${lines.join("\n\n")}`;
    } catch (err) {
      return `Failed to list presets: ${(err as Error).message}`;
    }
  }
};

const gmailReadEmailTool: ToolDefinition = {
  name: "gmail_read_email",
  description: "Read the full content of a specific email by its message ID. Use this when a user asks to 'read that email', 'summarize the email from X', or needs the complete text of an email referenced in the heartbeat briefing.",
  parameters: {
    message_id: { type: "string", description: "The Gmail message ID (from gmail_list_messages results)", required: true },
  },
  async execute(params, ctx) {
    try {
      const wsId = requireWorkspace(ctx);
      const { gmailReadEmail } = await import("@/integrations/clients");
      const email = await gmailReadEmail(wsId, params.message_id);
      return `*Email Details*\nFrom: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n*Full Content:*\n${email.body.slice(0, 8000)}`;
    } catch (err) {
      return integrationError("Gmail", err);
    }
  },
};

const gmailReplyEmailTool: ToolDefinition = {
  name: "gmail_reply_email",
  description: "Reply to an existing email thread from the user's connected Gmail account. Use this when the user says 'reply to that email' or 'respond to X's message'.",
  parameters: {
    message_id: { type: "string", description: "The Gmail message ID to reply to", required: true },
    body: { type: "string", description: "The reply body content (plain text or HTML)", required: true },
  },
  async execute(params, ctx) {
    try {
      const wsId = requireWorkspace(ctx);
      const { gmailReplyEmail } = await import("@/integrations/clients");
      const result = await gmailReplyEmail(wsId, params.message_id, params.body);
      return `Reply sent successfully to ${result.to} (subject: "${result.subject}").`;
    } catch (err) {
      return integrationError("Gmail", err);
    }
  },
};

const slackPostToChannelTool: ToolDefinition = {
  name: "slack_post_to_channel",
  description: "Post a message to any Slack channel the bot is a member of. Use this for cross-channel coordination (e.g., posting a standup update to #huddles while responding in #general), scheduled updates, or proactive notifications to specific channels.",
  parameters: {
    channel_id: { type: "string", description: "The Slack channel ID to post to. Use 'slack_list_channels' first to find the correct ID.", required: true },
    message: { type: "string", description: "The message text to post (Slack mrkdwn format)", required: true },
  },
  async execute(params, ctx) {
    if (!ctx.slackTeamId) {
      return "Error: Slack Team ID context is missing. Unable to post to channel.";
    }

    try {
      const { getWorkspaceSlack } = await import("@/integrations/slack/client");
      const wsSlack = await getWorkspaceSlack(ctx.slackTeamId);

      const result = await wsSlack.chat.postMessage({
        channel: params.channel_id,
        text: params.message,
      });

      if (result.ok) {
        return `Message posted successfully to <#${params.channel_id}>.`;
      } else {
        return `Failed to post to channel: ${(result as any).error || "Unknown error"}`;
      }
    } catch (err) {
      return `Failed to post to channel: ${(err as Error).message}`;
    }
  },
};

const taskCancelTool: ToolDefinition = {
  name: "task_cancel",
  description: "Cancel or stop a currently running or queued task (document, research, analytics) or build run in this channel or thread.",
  parameters: {
    task_id: { type: "string", description: "Optional UUID of the task to cancel/stop" },
    run_id: { type: "string", description: "Optional UUID of the build run to cancel/stop" },
  },
  async execute(params, ctx) {
    try {
      const { updateTask, updateRun, getActiveTaskByThreadTs, getActiveRunByThreadTs } = await import("@/db");

      let cancelledCount = 0;
      let detail = "";

      // 1. Cancel by specified task_id
      if (params.task_id) {
        await updateTask(params.task_id, { status: "error" });
        cancelledCount++;
        detail = `Task with ID ${params.task_id}`;
      }

      // 2. Cancel by specified run_id
      if (params.run_id) {
        await updateRun(params.run_id, { status: "error" });
        cancelledCount++;
        detail = `Build run with ID ${params.run_id}`;
      }

      // 3. Cancel active task/run in current thread if no ID was provided
      if (!params.task_id && !params.run_id) {
        if (!ctx.slackThreadTs) {
          return "Error: No specific task_id or run_id was provided, and no thread context is available to find the active task.";
        }

        const [activeTasks, activeRuns] = await Promise.all([
          getActiveTaskByThreadTs(ctx.slackThreadTs),
          getActiveRunByThreadTs(ctx.slackThreadTs),
        ]);

        if (activeTasks && activeTasks.length > 0) {
          await updateTask(activeTasks[0].id, { status: "error" });
          cancelledCount++;
          detail = `active task "${activeTasks[0].request.slice(0, 40)}..."`;
        }

        if (activeRuns && activeRuns.length > 0) {
          await updateRun(activeRuns[0].id, { status: "error" });
          cancelledCount++;
          detail = `active build run "${activeRuns[0].request.slice(0, 40)}..."`;
        }
      }

      if (cancelledCount === 0) {
        return "No active tasks or build runs were found to cancel in this thread.";
      }

      return `Successfully cancelled ${detail}. The system will no longer monitor or execute it.`;
    } catch (err) {
      return `Failed to cancel task: ${(err as Error).message}`;
    }
  }
};

// ── Tool Registry ──


export const allTools: ToolDefinition[] = [
  webSearchTool,
  webReadTool,
  codeExecuteTool,
  parseDocumentTool,
  memorySaveTool,
  memorySearchTool,
  knowledgeSearchTool,
  knowledgeIndexResourceTool,
  // Integration tools
  googleDriveSearchTool,
  googleDriveReadTool,
  gmailSendEmailTool,
  gmailListMessagesTool,
  githubSearchTool,
  githubReadFileTool,
  githubIssuesTool,
  githubUpdateFileTool,
  githubCreatePullRequestTool,
  // Browser automation tools
  browserBrowseTool,
  browserScrapeTool,
  browserLinksTool,
  browserInteractTool,
  browserScreenshotTool,
  // Custom Webhook and Communication Tools
  webhookCustomRequestTool,
  resendSendEmailTool,
  googleCalendarListEventsTool,
  // Scheduling tools
  scheduleCreateTool,
  scheduleListTool,
  scheduleDeleteTool,
  scheduleToggleTool,
  taskCancelTool,
  scheduleListPresetsTool,
  slackListChannelsTool,
  sequentialThinkingTool,
  // MCP Management
  mcpConnectTool,
  mcpListTool,
  mcpRemoveTool,
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
  parseDocumentTool,
  memorySaveTool,
  memorySearchTool,
  knowledgeSearchTool,
  knowledgeIndexResourceTool,
  // Integration tools — the agent will handle "not connected" gracefully
  googleDriveSearchTool,
  googleDriveReadTool,
  gmailSendEmailTool,
  gmailListMessagesTool,
  gmailReadEmailTool,
  gmailReplyEmailTool,
  githubListReposTool,
  githubSearchTool,
  githubReadFileTool,
  githubIssuesTool,
  // Browser tools
  browserBrowseTool,
  browserScrapeTool,
  browserLinksTool,
  browserInteractTool,
  browserScreenshotTool,
  // Custom Webhook and Communication Tools
  webhookCustomRequestTool,
  resendSendEmailTool,
  googleCalendarListEventsTool,

  // Agent dispatch (fallback for complex workflows)
  dispatchTaskTool,
  dispatchWorkflowTool,
  // Scheduling tools
  scheduleCreateTool,
  scheduleListTool,
  scheduleDeleteTool,
  scheduleToggleTool,
  taskCancelTool,
  scheduleEditTool,
  scheduleListPresetsTool,
  // Channel awareness
  slackListChannelsTool,
  slackPostToChannelTool,
  sequentialThinkingTool,
  // MCP Management
  mcpConnectTool,
  mcpListTool,
  mcpRemoveTool,
];

/** Tools available to the PM Agent (research for specs) */
export const pmAgentTools: ToolDefinition[] = [
  webSearchTool,
  webReadTool,
  browserBrowseTool,
  browserScrapeTool,
  googleDriveSearchTool,
  googleDriveReadTool,
  githubListReposTool,
  githubIssuesTool,
  memorySearchTool,
  knowledgeSearchTool,
  knowledgeIndexResourceTool,
  scheduleCreateTool,
  scheduleListTool,
  scheduleToggleTool,
  taskCancelTool,
  scheduleEditTool,
  slackListChannelsTool,
  sequentialThinkingTool,
];

/** Tools available to the Research Agent (deep research) */
export const researchAgentTools: ToolDefinition[] = [
  webSearchTool,
  webReadTool,
  browserBrowseTool,
  browserScrapeTool,
  browserLinksTool,
  browserInteractTool,
  parseDocumentTool,
  memorySearchTool,
  knowledgeSearchTool,
  knowledgeIndexResourceTool,
  googleDriveSearchTool,
  scheduleCreateTool,
  scheduleListTool,
  scheduleToggleTool,
  slackListChannelsTool,
  sequentialThinkingTool,
];

/** Tools available to the Analyst Agent (code execution) */
export const analystAgentTools: ToolDefinition[] = [
  codeExecuteTool,
  webSearchTool,
  webReadTool,
  browserBrowseTool,
  parseDocumentTool,
  memorySearchTool,
  sequentialThinkingTool,
];

/** Tools available to the Engineer Agent (research + code verification + docs browsing) */
export const engineerAgentTools: ToolDefinition[] = [
  githubListReposTool,
  githubSearchTool,
  githubReadFileTool,
  githubIssuesTool,
  githubUpdateFileTool,
  githubCreatePullRequestTool,
  parseDocumentTool,
  memorySearchTool,
  knowledgeSearchTool,
  knowledgeIndexResourceTool,
  sequentialThinkingTool,
];

/** Tools available to the QA Agent (code evaluation + deployment) */
export const qaAgentTools: ToolDefinition[] = [
  githubListReposTool,
  webSearchTool,
  webReadTool,
  codeExecuteTool,
  githubSearchTool,
  githubReadFileTool,
  githubIssuesTool,
  githubUpdateFileTool,
  githubCreatePullRequestTool,
  memorySearchTool,
  sequentialThinkingTool,
];

/** Tools available to the Documentor Agent (writing docs + reading files) */
export const documentorAgentTools: ToolDefinition[] = [
  webSearchTool,
  webReadTool,
  parseDocumentTool,
  googleDriveSearchTool,
  knowledgeIndexResourceTool,
  googleDriveReadTool,
  githubReadFileTool,
  memorySearchTool,
  sequentialThinkingTool,
];

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
