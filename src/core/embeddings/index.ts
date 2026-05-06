/**
 * Embedding Service — generates vector embeddings for semantic search.
 *
 * Uses the Ollama-compatible /v1/embeddings endpoint with a lightweight
 * embedding model (all-minilm, 384 dimensions). Falls back gracefully
 * if the embedding service is unavailable.
 */

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "all-minilm";
const EMBEDDING_DIMENSIONS = 384;

/** Get the embedding API base URL from the same Ollama provider we already use. */
function getEmbeddingUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "https://api.ollama.com/v1") + "/embeddings";
}

function getApiKey(): string {
  return process.env.OLLAMA_API_KEY_1 || process.env.OLLAMA_API_KEY_2 || "";
}

/**
 * Generate a vector embedding for a text string.
 * Returns a 384-dimensional float array, or null if the service is unavailable.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;

  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[EMBEDDING] No API key configured, skipping embedding generation");
    return null;
  }

  try {
    const response = await fetch(getEmbeddingUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 2000), // Limit input to prevent token overflow
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      console.warn(`[EMBEDDING] API returned ${response.status}: ${await response.text().catch(() => "")}`);
      return null;
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
    };

    const embedding = data?.data?.[0]?.embedding;
    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`[EMBEDDING] Unexpected dimensions: got ${embedding?.length}, expected ${EMBEDDING_DIMENSIONS}`);
      return null;
    }

    return embedding;
  } catch (err) {
    console.warn("[EMBEDDING] Generation failed:", (err as Error).message);
    return null;
  }
}

/**
 * Format an embedding array as a pgvector-compatible string.
 * e.g., [0.1, 0.2, 0.3] → "[0.1,0.2,0.3]"
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
