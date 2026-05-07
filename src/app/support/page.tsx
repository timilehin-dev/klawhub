import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { HelpCircle, MessageSquare, BookOpen, Mail, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Support & Help Center | Klawhub AI Coworker",
  description: "Get assistance, review guides, or contact Klawhub support for your Slack AI coworker integrations.",
};

export default function SupportPage() {
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
            <div className="text-center max-w-2xl mx-auto">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 mb-4 shadow-lg shadow-brand-500/10">
                <HelpCircle size={24} />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-surface-900 sm:text-4xl">
                Support & Help Center
              </h1>
              <p className="mt-3 text-lg text-surface-700">
                We are here to help you configure, scale, and master your autonomous Klawhub AI coworker.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card 1: Slack Onboarding */}
              <div className="p-6 rounded-xl border border-surface-200 bg-surface-50/50 space-y-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <MessageSquare size={20} />
                </div>
                <h3 className="text-lg font-bold text-surface-900">Slack Interaction Guides</h3>
                <p className="text-sm text-surface-700 leading-relaxed">
                  Learn how to trigger specialized agent workflows (Build, Document, Research, and Analytics) via direct messages or channel mentions.
                </p>
                <div className="pt-2">
                  <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full">
                    DM @Klawhub
                  </span>
                </div>
              </div>

              {/* Card 2: Custom Webhooks & APIs */}
              <div className="p-6 rounded-xl border border-surface-200 bg-surface-50/50 space-y-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                  <BookOpen size={20} />
                </div>
                <h3 className="text-lg font-bold text-surface-900">Custom Webhooks & Integrations</h3>
                <p className="text-sm text-surface-700 leading-relaxed">
                  Configure AES-256-GCM secure header credentials, query custom API endpoints, and wire up Google Drive or GitHub actions.
                </p>
                <div className="pt-2">
                  <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full">
                    Developer Docs
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Contact & Escalation */}
            <div className="mt-12 rounded-xl border border-brand-100 bg-brand-50/30 p-6 md:p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                  <Mail size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-surface-900">Contact Support</h3>
                  <p className="text-xs text-surface-700 mt-0.5">Response time usually under 2 hours</p>
                </div>
              </div>
              
              <div className="space-y-3 text-sm text-surface-700">
                <p className="leading-relaxed">
                  Have a technical inquiry or facing issues connecting your workspace? Drop us an email and our engineering support squad will guide you step-by-step.
                </p>
                <p className="font-bold text-surface-900">
                  Email: <a href="mailto:support@klawhub.xyz" className="text-brand-600 hover:underline">support@klawhub.xyz</a>
                </p>
              </div>

              <div className="border-t border-brand-100 pt-4 flex items-center gap-2 text-xs text-brand-800 font-semibold">
                <ShieldCheck size={16} />
                <span>Secure SSL Sandbox Encryption active for all support request telemetry.</span>
              </div>
            </div>

            {/* Common FAQ Accordion Mock */}
            <div className="mt-12 border-t border-surface-100 pt-8 space-y-6">
              <h2 className="text-xl font-bold text-surface-900">Frequently Asked Questions</h2>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-surface-900 text-sm">How do I invite Klawhub to a private Slack channel?</h4>
                  <p className="text-xs text-surface-700 leading-relaxed">
                    Simply type <code className="bg-surface-100 px-1 py-0.5 rounded text-brand-600">/invite @Klawhub</code> in the channel text bar. The agent will immediately join and analyze subsequent mentions.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <h4 className="font-semibold text-surface-900 text-sm">Can I run custom builds in the sandbox environment?</h4>
                  <p className="text-xs text-surface-700 leading-relaxed">
                    Yes! When triggering a build, Klawhub spins up a high-performance isolated sandbox container on our secure server network to compile and validate scripts.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <h4 className="font-semibold text-surface-900 text-sm">What happens to my decrypted webhook headers?</h4>
                  <p className="text-xs text-surface-700 leading-relaxed">
                    Decryption is processed strictly ephemerally in RAM during the active tool execution loop and never written to database logs or cached.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
