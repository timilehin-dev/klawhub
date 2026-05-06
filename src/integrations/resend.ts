/**
 * Resend Email dispatch client.
 * Standardized, lightweight wrapper utilizing Resend's REST API.
 * Uses process.env.RESEND_API_KEY for authorization.
 */
export async function resendSendEmail(to: string, subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set. Please add it to your environment.");
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "Klawhub AI Coworker <onboarding@resend.dev>";

  // Format the request body following Resend's standard specifications
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: subject,
      html: body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Resend API failed with status ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.message) errorMessage += `: ${errorJson.message}`;
    } catch {
      if (errorText) errorMessage += `: ${errorText}`;
    }
    throw new Error(errorMessage);
  }
}
