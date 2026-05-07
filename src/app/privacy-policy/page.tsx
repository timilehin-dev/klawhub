import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Privacy Policy | Klawhub AI Coworker",
  description: "Our policies on data privacy, Google API scopes, and security for the Klawhub AI Coworker service.",
};

export default function PrivacyPolicy() {
  return (
    <>
      <Header />
      <main className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-32 min-h-screen bg-surface-50">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-brand-200/20 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-200/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl px-6">
          <div className="rounded-2xl border border-surface-200 bg-white p-8 md:p-12 shadow-xl shadow-surface-100/50">
            <h1 className="text-3xl font-extrabold tracking-tight text-surface-900 sm:text-4xl">
              Privacy Policy
            </h1>
            <p className="mt-2 text-sm text-surface-500">
              Last Updated: May 6, 2026
            </p>

            <div className="mt-8 border-t border-surface-100 pt-8 prose prose-slate max-w-none text-surface-700 space-y-6">
              <p className="leading-relaxed">
                At <strong>Klawhub</strong> (accessible at <a href="https://klawhub.xyz" className="text-brand-600 hover:underline">klawhub.xyz</a>), we are committed to protecting your privacy. This Privacy Policy documents the types of information collected and stored by Klawhub and explains how we use it to deliver our autonomous AI coworker services.
              </p>

              <hr className="border-surface-100" />

              <section className="space-y-3">
                <h2 className="text-xl font-bold text-surface-900">1. Information We Collect</h2>
                <p className="leading-relaxed">
                  To operate Klawhub, we collect and process specific information about your team and active workspaces:
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-sm">
                  <li><strong>Account Credentials & Contact Info</strong>: Usernames, workspace ID, and email addresses.</li>
                  <li><strong>Workspace Integration Tokens</strong>: Cryptographically encrypted access tokens for third-party platforms (including Slack, Google Workspace, and GitHub).</li>
                  <li><strong>Workspace Communication Data</strong>: Text messages and file attachments transmitted to Klawhub in integrated Slack channels (such as PDF invoices, text logs, or project specs) to trigger agent-led operations.</li>
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-bold text-surface-900">2. Google API Data Usage Disclosure</h2>
                <p className="leading-relaxed">
                  Klawhub integrates with Google APIs to retrieve and structure relevant context for your tasks. We strictly adhere to the <strong>Google API Services User Data Policy</strong>, including the Limited Use requirements.
                </p>
                <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-brand-900">How We Use Google Scopes:</h3>
                  <ul className="list-disc pl-5 space-y-2 text-xs text-surface-700">
                    <li><strong>Google Drive Read-Only (`/auth/drive.readonly`)</strong>: Used by the Google Drive Search & Read tools to locate and extract text from documentation files, PDFs, or spreadsheets that you explicitly ask Klawhub to analyze.</li>
                    <li><strong>Google Calendar Read-Only (`/auth/calendar.readonly`)</strong>: Used by the Google Calendar tool to list upcoming meeting titles, timelines, and descriptions. This allows Klawhub to automatically prepare briefings and agenda packages for you in advance.</li>
                    <li><strong>Gmail Read, Write, & Send (`/auth/gmail.readonly`, `/auth/gmail.send`)</strong>: Allows Klawhub's communications agent to draft summaries and send emails on your behalf based on your direct Slack commands or pre-approved builds.</li>
                  </ul>
                  <p className="text-xs font-semibold text-brand-900">
                    Data Isolation & Transfer: Google user data is processed ephemeral-in-RAM, is never sold to third parties, is not used for advertising, and is not transferred for any purpose other than executing user-initiated tasks.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-bold text-surface-900">3. Cryptographic Token Protection</h2>
                <p className="leading-relaxed">
                  Security is our core engineering priority. All integration credentials, including OAuth refresh tokens and custom webhooks headers, are fully protected at rest utilizing an advanced <strong>AES-256-GCM Secure Envelope Encryption</strong> standard. This ensures your authorization tokens cannot be read or leaked.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-bold text-surface-900">4. Sharing and Third-Party API Processing</h2>
                <p className="leading-relaxed">
                  We process text interactions and document content using secure AI models (such as secure Modal serverless sandboxes and verified REST dispatch). We do not share your raw data or files with third parties for marketing or any other commercial reasons.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-bold text-surface-900">5. Data Retention and Deletion</h2>
                <p className="leading-relaxed">
                  We store user data only as long as necessary to provide Klawhub services. If you delete an integration, or request data cleanup, your database records and credentials are wiped completely from our secure database clusters within 24 hours.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-bold text-surface-900">6. Contact Us</h2>
                <p className="leading-relaxed">
                  If you have any questions about this Privacy Policy, or want to make a data deletion request, please contact us at:
                </p>
                <p className="text-sm font-semibold text-surface-900">
                  Email: <a href="mailto:support@klawhub.xyz" className="text-brand-600 hover:underline">support@klawhub.xyz</a>
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
