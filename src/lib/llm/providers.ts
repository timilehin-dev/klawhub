/**
 * LLM Provider Configuration
 *
 * Each provider defines how to reach an OpenAI-compatible API endpoint.
 * Add new providers here — the router picks the right one per-agent.
 */

export interface ProviderConfig {
  id: string;
  baseUrl: string;
  keys: string[];
  model: string;
  provider: string; // label for usage logs
}

/** Build a provider from environment variables. Returns null if unconfigured. */
function fromEnv(
  id: string,
  baseUrl: string | undefined,
  keyEnvs: string[],
  model: string,
  provider: string
): ProviderConfig | null {
  const keys = keyEnvs
    .map((e) => process.env[e])
    .filter((k): k is string => !!k);
  if (keys.length === 0 || !baseUrl) return null;
  return { id, baseUrl, keys, model, provider };
}

/**
 * All configured providers. Edit this list to add/remove/reorder providers.
 * The router uses the first match for a given agent assignment.
 */
export function getProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // 1. Ollama (default — used by all agents unless overridden)
  const ollama = fromEnv(
    "ollama",
    process.env.OLLAMA_BASE_URL || "https://api.ollama.com/v1",
    ["OLLAMA_API_KEY_1", "OLLAMA_API_KEY_2"],
    process.env.OLLAMA_MODEL || "gemma4:31b-cloud",
    "ollama"
  );
  if (ollama) providers.push(ollama);

  // 2. AIHubMix (used by engineer agent for coding tasks)
  const aihubmix = fromEnv(
    "aihubmix",
    "https://aihubmix.com/v1",
    ["AIHUBMIX_API_KEY_1", "AIHUBMIX_API_KEY_2"],
    process.env.AIHUBMIX_MODEL || "kimi-k2.5-free",
    "aihubmix"
  );
  if (aihubmix) providers.push(aihubmix);

  return providers;
}

/**
 * Agent-to-provider mapping.
 * Key = agent name, Value = provider id (or "default" for the first provider).
 *
 * Override per-agent here. Agents not listed use the "default" provider.
 */
export const AGENT_PROVIDER_MAP: Record<string, string> = {
  engineer: "aihubmix",     // Engineer uses AIHubMix for better code generation
  // All other agents (classifier, general, pm, qa, researcher, etc.) use "default" (Ollama)
};

export const DEFAULT_PROVIDER_ID = "default";
