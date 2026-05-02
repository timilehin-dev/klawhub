import { llm } from "@/lib/llm";
import { sandbox } from "@/lib/tools/sandbox";

const DOCSTRUCTURE_PROMPT = `You are the Document Agent of Klawhub. You structure content for professional documents.

Given a document request, produce a structured JSON object with the document content.
The output must be valid JSON with this exact structure:
{
  "title": "Document Title",
  "format": "pdf",
  "sections": [
    {"heading": "Section Title", "body": "Section content..."},
    {"heading": "Another Section", "body": "More content..."}
  ]
}

Rules:
- format should be "pdf" or "docx" based on what the user requests (default "pdf")
- Write substantive content for each section (at least 3-5 sentences per section)
- Use professional language and tone
- Include logical section breaks
- Return ONLY the JSON, no markdown fences, no explanation`;

export async function generateDocument(request: string) {
  const messages = [
    { role: "system" as const, content: DOCSTRUCTURE_PROMPT },
    { role: "user" as const, content: request },
  ];

  const response = await llm.chat(messages, { temperature: 0.4, maxTokens: 3000 });

  // Parse JSON from response (handle markdown fences)
  let jsonStr = response.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const docStructure = JSON.parse(jsonStr);

  // Generate document via sandbox
  const result = await sandbox({
    type: "document",
    format: docStructure.format || "pdf",
    title: docStructure.title,
    sections: docStructure.sections,
  });

  return {
    title: docStructure.title,
    format: docStructure.format || "pdf",
    sections: docStructure.sections,
    fileData: result.output_file,
    filename: result.filename,
    success: result.success,
    error: result.error,
  };
}
