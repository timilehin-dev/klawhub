import { agentChat } from "@/core/llm";
import { sandbox } from "@/core/tools/sandbox";
import { COWORKER_VOICE_MODULE } from "./persona";

const DOCSTRUCTURE_PROMPT = `You are the Document Agent of Klawhub. You structure content for professional documents.
${COWORKER_VOICE_MODULE}

YOUR ROLE: Given a document request, produce a structured JSON object with the document content.
The output must be valid JSON with this exact structure:
{
  "title": "Document Title",
  "format": "pdf",
  "sections": [
    {"heading": "Section Title", "body": "Section content with multiple sentences..."},
    {"heading": "Another Section", "body": "More detailed content..."}
  ]
}

Rules:
- format should be "pdf" or "docx" based on what the user requests (default "pdf")
- Write substantive content for each section (at least 3-5 sentences per section body)
- Use professional language and tone appropriate for the document type
- Include logical section breaks and clear headings
- Structure the document like a professional would
- Return ONLY the JSON, no markdown fences, no explanation`;

function safeJsonParse(raw: string): Record<string, any> | null {
  let cleaned = raw.trim();

  // Attempt to parse directly
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // console.debug("First JSON parse attempt failed:", e.message);
  }

  // If it's wrapped in markdown code block, try to extract and parse
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // console.debug("Second JSON parse attempt (after markdown strip) failed:", e.message);
    }
  }

  // Fallback: try to find the first JSON object in the string
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // console.debug("Third JSON parse attempt (regex extract) failed:", e.message);
    }
  }

  console.error("Failed to parse JSON after multiple attempts. Raw input:", raw.slice(0, 500));
  return null;
}

export async function generateDocument(request: string, userContext = "", meta?: { taskId?: string; slackUserId?: string }) {
  const contextNote = userContext ? `\n\nUser context (use to personalize the document):\n${userContext}` : "";
  const messages = [
    { role: "system" as const, content: DOCSTRUCTURE_PROMPT },
    { role: "user" as const, content: request + contextNote },
  ];

  const response = await agentChat("documentor", messages, { temperature: 0.4, maxTokens: 131072 }, meta);

  const docStructure = safeJsonParse(response);
  if (!docStructure || !docStructure.sections || !docStructure.title) {
    throw new Error("Failed to parse document structure from LLM output. Please try rephrasing your request.");
  }

  const format = docStructure.format === "docx" ? "docx" : "pdf";

  // Generate document via sandbox
  const result = await sandbox({
    type: "document",
    format,
    title: docStructure.title,
    sections: docStructure.sections,
  });

  return {
    title: docStructure.title,
    format,
    sections: docStructure.sections,
    fileData: result.output_file,
    filename: result.filename,
    success: result.success,
    error: result.error,
  };
}

/** Generate just the outline for approval (lighter weight). */
export async function generateOutline(request: string, userContext = "", meta?: { taskId?: string; slackUserId?: string }) {
  const contextNote = userContext ? `\n\nUser context: ${userContext}` : "";
  const messages = [
    {
      role: "system" as const,
      content: `You are the Document Agent of Klawhub. Given a document request, produce a brief outline.
${COWORKER_VOICE_MODULE}

Return ONLY a JSON object:
{
  "title": "Document Title",
  "format": "pdf",
  "sections": [
    {"heading": "Section Title", "body": "2-3 sentence summary of what this section will cover."}
  ]
}

Keep section bodies brief (summaries, not full content). The user will approve the outline before full generation.`,
    },
    { role: "user" as const, content: request + contextNote },
  ];

  const response = await agentChat("documentor", messages, { temperature: 0.4, maxTokens: 131072 }, meta);
  const outline = safeJsonParse(response);

  if (!outline || !outline.title || !outline.sections) {
    throw new Error("Failed to generate document outline. Please try again.");
  }

  return {
    title: outline.title,
    format: outline.format === "docx" ? "docx" : "pdf",
    sections: outline.sections,
  };
}
