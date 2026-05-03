import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ArrowRight, MessageSquare, FileText, Search, BarChart3, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Install Klawhub — Add to Your Slack Workspace",
  description:
    "Install Klawhub in your Slack workspace in under 60 seconds. No credit card required.",
};

const setupSteps = [
  {
    icon: ArrowRight,
    title: "Click \"Add to Slack\"",
    description:
      "You'll be redirected to Slack to authorize Klawhub in your workspace. Choose which channels to invite it to.",
  },
  {
    icon: MessageSquare,
    title: "Say Hello",
    description:
      "DM @Klawhub or use /klawhub in any channel. The bot will introduce itself and learn your preferences.",
  },
  {
    icon: CheckCircle2,
    title: "Start Working",
    description:
      "Ask Klawhub to build something, write a document, research a topic, or analyze data. The agents go to work immediately.",
  },
];

const capabilities = [
  {
    icon: MessageSquare,
    title: "Build Code",
    desc: "Scripts, tools, web apps, automations — spec, build, and test in one workflow.",
  },
  {
    icon: FileText,
    title: "Generate Documents",
    desc: "Reports, proposals, invoices exported as PDF or DOCX with professional formatting.",
  },
  {
    icon: Search,
    title: "Deep Research",
    desc: "Multi-step web research with cited sources and actionable insights.",
  },
  {
    icon: BarChart3,
    title: "Data Analytics",
    desc: "Python-powered analysis with publication-ready charts and visualizations.",
  },
];

export default function InstallPage() {
  return (
    <>
      <Header />

      <section className="pt-32 pb-20 lg:pt-40 lg:pb-28">
        <div className="mx-auto max-w-7xl px-6">
          {/* Hero */}
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5">
              <span className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
              <span className="text-sm font-medium text-brand-700">
                Free to install &middot; No credit card required
              </span>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight text-surface-900 sm:text-5xl">
              Add Klawhub to{" "}
              <span className="gradient-text">Your Slack</span>
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-surface-700">
              Get a full AI coworker in your workspace in under 60 seconds.
              No new tools, no learning curve — just Slack.
            </p>

            {/* Slack install button */}
            <div className="mt-10">
              <a
                href="https://slack.com/oauth/v2/authorize?client_id=&scope=commands,chat:write,chat:write.public,chat:write.customize,app_mentions:read,users:read,channels:read,groups:read,im:read,im:history,channels:history,groups:history,reactions:read,files:read,files:write"
                className="inline-flex items-center gap-3 rounded-full gradient-bg px-10 py-4 text-lg font-semibold text-white shadow-xl shadow-brand-500/25 transition-all hover:shadow-2xl hover:shadow-brand-500/30 hover:brightness-110"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 fill-current"
                  aria-hidden="true"
                >
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" />
                </svg>
                Add to Slack
              </a>
              <p className="mt-4 text-sm text-surface-700">
                Requires permission to post messages, read channels, and upload
                files
              </p>
            </div>
          </div>

          {/* Setup Steps */}
          <div className="mt-20">
            <h2 className="text-center text-2xl font-bold text-surface-900 sm:text-3xl">
              Setup in 3 Steps
            </h2>
            <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
              {setupSteps.map((step, i) => (
                <div
                  key={i}
                  className="relative rounded-2xl border border-surface-200 bg-white p-6"
                >
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50">
                    <step.icon size={20} className="text-brand-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-surface-900">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-surface-700">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Capabilities Preview */}
          <div className="mt-20 rounded-3xl border border-surface-200 bg-surface-50 p-8 lg:p-12">
            <h2 className="text-center text-2xl font-bold text-surface-900 sm:text-3xl">
              What You Get
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {capabilities.map((cap) => (
                <div
                  key={cap.title}
                  className="rounded-xl border border-surface-200 bg-white p-5"
                >
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50">
                    <cap.icon size={20} className="text-brand-600" />
                  </div>
                  <h3 className="font-semibold text-surface-900">
                    {cap.title}
                  </h3>
                  <p className="mt-1 text-sm text-surface-700">{cap.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Permissions Note */}
          <div className="mt-12 mx-auto max-w-2xl text-center">
            <p className="text-sm leading-relaxed text-surface-700">
              <strong>Privacy first:</strong> Klawhub only accesses messages
              where it is mentioned or DM&apos;d. All code execution runs in
              isolated sandboxes. Your data is never used for training.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
