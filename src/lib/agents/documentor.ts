import { llm } from "@/lib/llm";
import { sandbox } from "@/lib/tools/sandbox";

const DOCSTRUCTURE_PROMPT = `You are the Document Agent of Klawhub. You structure content for professional documents.

Given a document request, produce a structured JSON object with the document content.
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
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch { /* continue */ }

  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  // Try to extract JSON object from surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* continue */ }
  }

  return null;
}

export async function generateDocument(request: string, userContext = "") {
  const contextNote = userContext ? `\n\nUser context (use to personalize the document):\n${userContext}` : "";
  const messages = [
    { role: "system" as const, content: DOCSTRUCTURE_PROMPT },
    { role: "user" as const, content: request + contextNote },
  ];

  const response = await llm.chat(messages, { temperature: 0.4, maxTokens: 6000 });

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
export async function generateOutline(request: string, userContext = "") {
  const contextNote = userContext ? `\n\nUser context: ${userContext}` : "";
  const messages = [
    {
      role: "system" as const,
      content: `You are the Document Agent of Klawhub. Given a document request, produce a brief outline.


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

  const response = await llm.chat(messages, { temperature: 0.4, maxTokens: 3000 });
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
