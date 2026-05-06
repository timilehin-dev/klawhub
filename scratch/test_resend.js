const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Error: .env.local file not found at " + envPath);
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  const env = {};
  content.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const firstEq = trimmed.indexOf("=");
    if (firstEq === -1) return;
    const key = trimmed.slice(0, firstEq).trim();
    let val = trimmed.slice(firstEq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  });
  return env;
}

async function testResend() {
  const env = loadEnv();
  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.RESEND_FROM_EMAIL || "Klawhub AI Coworker <onboarding@resend.dev>";

  if (!apiKey) {
    console.error("Error: RESEND_API_KEY is not defined in your .env.local file!");
    process.exit(1);
  }

  // Retrieve recipient address from the terminal arguments
  const recipient = process.argv[2];
  if (!recipient) {
    console.log("\nUsage: node scratch/test_resend.js <recipient_email_address>");
    console.log("Example: node scratch/test_resend.js your_email@example.com\n");
    process.exit(1);
  }

  console.log(`\n🚀 Preparing to send email via Resend...`);
  console.log(`From:    ${fromEmail}`);
  console.log(`To:      ${recipient}`);
  console.log(`Subject: 📬 Klawhub Integration Live Test`);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
        subject: "📬 Klawhub Integration Live Test",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 25px; border: 1px solid #eaeaea; border-radius: 8px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <div style="text-align: center; margin-bottom: 20px;">
              <h1 style="color: #4f46e5; margin: 0; font-size: 24px;">KLAWHUB</h1>
              <p style="color: #6b7280; margin: 5px 0 0 0; font-size: 14px;">Autonomous AI Coworker Pipeline</p>
            </div>
            <hr style="border: 0; border-top: 1px solid #eaeaea; margin-bottom: 20px;">
            <p>Hello there!</p>
            <p>This is a live transactional test confirming that your <strong>Klawhub Resend Integration</strong> is active and verified!</p>
            <p style="margin: 20px 0; padding: 15px; background-color: #f9fafb; border-left: 4px solid #4f46e5; border-radius: 0 4px 4px 0; font-size: 14px; line-height: 1.5;">
              <strong>Connection Status:</strong> Active & Authorized<br>
              <strong>Verified Domain:</strong> klawhub.xyz<br>
              <strong>Sender Identity:</strong> ${fromEmail}
            </p>
            <p>Your Klawhub agents are now fully authorized to dispatch professional briefings, codebase updates, and calendar preparation plans to anyone!</p>
            <hr style="border: 0; border-top: 1px solid #eaeaea; margin-top: 25px; margin-bottom: 15px;">
            <p style="color: #9ca3af; font-size: 11px; text-align: center; margin: 0;">Sent programmatically via Klawhub Core Integration Service.</p>
          </div>
        `,
      }),
    });

    const text = await response.text();
    console.log(`\nResponse Status: ${response.status} ${response.statusText}`);
    console.log(`Response Body:   ${text}`);

    if (response.ok) {
      console.log(`\n🎉 Success! The test email has been successfully dispatched via Resend.`);
    } else {
      console.log(`\n❌ Failed: Please verify your API Key and sender email address are valid.`);
    }
  } catch (err) {
    console.error(`\n❌ Request Error:`, err.message);
  }
}

testResend();
