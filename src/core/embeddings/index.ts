import { sandbox } from "../tools/sandbox";

const EMBEDDING_DIMENSIONS = 384;

/**
 * Generate a vector embedding for a text string.
 * Uses local FastEmbed (BAAI/bge-small-en-v1.5) inside the secure isolated Modal sandbox.
 * Returns a 384-dimensional float array, or null if the service is unavailable.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;

  try {
    const response = await sandbox({
      type: "generate_embedding",
      text: text.slice(0, 4000), // FastEmbed token boundary safe slice
    });

    if (response.success && response.embedding) {
      if (response.embedding.length !== EMBEDDING_DIMENSIONS) {
        console.warn(`[EMBEDDING] Unexpected dimensions: got ${response.embedding.length}, expected ${EMBEDDING_DIMENSIONS}`);
        return null;
      }
      return response.embedding;
    }

    console.warn(`[EMBEDDING] Sandbox returned unsuccessful: ${response.error}`);
    return null;
  } catch (err) {
    console.warn("[EMBEDDING] FastEmbed sandboxed generation failed:", (err as Error).message);
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
