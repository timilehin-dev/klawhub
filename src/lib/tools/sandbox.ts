import type { SandboxRequest, SandboxResponse } from "@/types";

const SANDBOX_TIMEOUT = 120_000; // 2 minutes

export async function sandbox(request: SandboxRequest): Promise<SandboxResponse> {
  const modalUrl = process.env.MODAL_FUNCTION_URL;
  if (!modalUrl) throw new Error("MODAL_FUNCTION_URL is not set");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add auth header if webhook secret is configured
  const webhookSecret = process.env.MODAL_WEBHOOK_SECRET;
  if (webhookSecret) {
    headers["X-Webhook-Secret"] = webhookSecret;
  }

  const response = await fetch(modalUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(SANDBOX_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sandbox error ${response.status}: ${text.slice(0, 300)}`);
  }

  return response.json();
}
