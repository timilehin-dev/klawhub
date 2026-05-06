// Shared types for the entire application

export type Intent =
  | "build"
  | "document"
  | "research"
  | "analytics"
  | "chat"
  | "unclear";

export interface ClassificationResult {
  type: Intent;
  extractedRequest?: string;
  response?: string;
  question?: string;
}

export interface SlackEventPayload {
  type: string;
  event?: {
    type: string;
    text?: string;
    user?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    bot_id?: string;
    subtype?: string;
  };
  event_id?: string;
  challenge?: string;
}

export interface RunStatus {
  pending: "pending";
  pm: "pm";
  coding: "coding";
  qa: "qa";
  done: "done";
  error: "error";
}

export interface TaskType {
  document: "document";
  research: "research";
  analytics: "analytics";
}

export interface TaskStatus {
  pending: "pending";
  processing: "processing";
  done: "done";
  error: "error";
}

export interface SandboxCodeRequest {
  type: "code";
  code: string;
  language: string;
  dependencies?: string;
}

export interface SandboxWebReadRequest {
  type: "web_read";
  url: string;
}

export interface SandboxDocumentRequest {
  type: "document";
  format: "pdf" | "docx";
  title: string;
  sections: Array<{ heading: string; body: string }>;
}

export interface SandboxAnalyticsRequest {
  type: "analytics";
  code: string;
  data?: string;
}

export interface SandboxParseDocumentRequest {
  type: "parse_document";
  file: string; // base64-encoded file content
  filename: string;
}

export interface SandboxGenerateEmbeddingRequest {
  type: "generate_embedding";
  text: string;
}

export type SandboxRequest =
  | SandboxCodeRequest
  | SandboxWebReadRequest
  | SandboxDocumentRequest
  | SandboxAnalyticsRequest
  | SandboxParseDocumentRequest
  | SandboxGenerateEmbeddingRequest;

export interface SandboxResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  output_file?: string; // base64-encoded file
  filename?: string;
  content?: string; // text content from web_read
  text?: string; // text content from document parsing
  embedding?: number[]; // vector array from local FastEmbed
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

export interface ParsedSchedule {
  name: string;
  cronExpr: string;
  timezone: string;
  action: string;
}

export interface KnowledgeEntity {
  entityType: "project" | "person" | "event" | "standing_item";
  entityName: string;
  data: Record<string, unknown>;
}
