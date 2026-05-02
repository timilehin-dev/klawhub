import type { SandboxRequest, SandboxResponse } from "@/types";

export async function sandbox(request: SandboxRequest): Promise<SandboxResponse> {
  const modalUrl = process.env.MODAL_FUNCTION_URL;
  if (!modalUrl) throw new Error("MODAL_FUNCTION_URL is not set");

  const response = await fetch(modalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sandbox error ${response.status}: ${text.slice(0, 300)}`);
  }

  return response.json();
}
