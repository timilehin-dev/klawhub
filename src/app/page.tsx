import {
  Wrench,
  FileText,
  Search,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { cookies } from "next/headers";
import { verifyWorkspaceId } from "@/utils/session";

const capabilities = [
  {
    icon: Wrench,
    title: "Build",
    description:
      "Generate production-ready code — scripts, tools, web apps, and automations. Goes through PM spec, engineer build, and QA testing before delivery.",
    color: "bg-blue-50 text-blue-600",
    iconBg: "bg-blue-100",
  },
  {
    icon: FileText,
    title: "Documents",
    description:
      "Create professional documents in seconds. Reports, proposals, invoices — exported as PDF or DOCX with proper formatting and structure.",
    color: "bg-purple-50 text-purple-600",
    iconBg: "bg-purple-100",
  },
  {
    icon: Search,
    title: "Research",
    description:
      "Deep research with adaptive multi-step search. Analyzes sources, extracts key findings, and delivers cited reports with actionable insights.",
    color: "bg-amber-50 text-amber-600",
    iconBg: "bg-amber-100",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    description:
      "Turn data into decisions. Upload datasets or describe what you need, and get Python-powered analysis with publication-ready charts.",
    color: "bg-emerald-50 text-emerald-600",
    iconBg: "bg-emerald-100",
  },
];

const features = [
  {
    title: "Multi-Agent Architecture",
    description:
      "Not a single chatbot — a team of specialized agents. A PM writes specs, engineers write code, QA tests it. A researcher digs deep while a documentor formats results. Each agent is purpose-built for its task.",
  },
  {
    title: "Runs Inside Slack",
    description:
      "No new apps, no new tabs, no context switching. Klawhub lives where your team already works. DM it, mention it in channels, or use slash commands. Results come back right in the conversation thread.",
  },
  {
    title: "Tool Use & Memory",
    description:
      "Agents don't just talk — they act. Web search, code execution, page reading, and memory recall are wired directly into the reasoning loop. The more you use Klawhub, the better it understands your context.",
  },
  {
    title: "Approval Workflow",
    description:
      "Important work gets human review. Build specs and document outlines are posted for your approval before execution. You stay in control while the AI does the heavy lifting.",
  },
  {
    title: "Scheduling & Automation",
    description:
      "Set up recurring tasks in plain English. Daily standup summaries, weekly reports, periodic research updates — all dispatched through the full agent pipeline on your schedule.",
  },
  {
    title: "Enterprise-Grade Security",
    description:
      "HMAC-verified Slack requests, authenticated sandbox execution, encrypted database storage. Your code, data, and conversations stay private and secure.",
  },
];

const steps = [
  {
    step: "01",
    title: "Ask in Slack",
    description:
      "DM @Klawhub, mention it in a channel, or use /klawhub. Describe what you need in plain English — a script, a report, research, or analysis.",
  },
  {
    step: "02",
    title: "Agents Go to Work",
    description:
      "Your request is classified and dispatched to the right team of agents. A PM writes specs, engineers build code, researchers dig into sources, QA validates everything.",
  },
  {
    step: "03",
    title: "Review & Approve",
    description:
      "For builds and documents, you get a spec or outline to review. Approve it, request changes, or reject it — you're always in control before resources are spent.",
  },
  {
    step: "04",
    title: "Get Results",
    description:
      "Finished work is delivered directly in your Slack thread. Code files, PDF/DOCX documents, research reports, or chart images — ready to use and share.",
  },
];

export default async function Home() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("kh_auth_session")?.value;
  const workspaceId = sessionCookie ? await verifyWorkspaceId(sessionCookie) : null;
  const isLoggedIn = !!workspaceId;

  return (
    <>
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-32">
        {/* Background decoration */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-brand-200/30 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-accent-400/20 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-100/40 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-4xl text-center">
            {/* Badge */}
            <div className="animate-fade-in-up mb-6 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5">
              <span className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
              <span className="text-sm font-medium text-brand-700">
                Now in Public Beta
              </span>
            </div>

            {/* Headline */}
            <h1 className="animate-fade-in-up-delay-1 text-4xl font-extrabold tracking-tight text-surface-900 sm:text-5xl lg:text-6xl">
              Your AI Coworker
              <br />
              <span className="gradient-text">Lives in Slack</span>
            </h1>

            {/* Subheadline */}
            <p className="animate-fade-in-up-delay-2 mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-surface-700 sm:text-xl">
              Build tools, generate documents, conduct research, and analyze
              data — all from a single Slack message. Multi-agent AI that
              actually delivers production-ready work.
            </p>

            {/* CTA Buttons */}
            <div className="animate-fade-in-up-delay-3 mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              {isLoggedIn ? (
                <Link
                  href="/dashboard"
                  className="group inline-flex items-center gap-2 rounded-full gradient-bg px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
                >
                  Go to Dashboard
                  <ArrowRight
                    size={18}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              ) : (
                <Link
                  href="/install"
                  className="group inline-flex items-center gap-2 rounded-full gradient-bg px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
                >
                  Add to Slack — Free
                  <ArrowRight
                    size={18}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              )}
              <Link
                href="/#how-it-works"
                className="inline-flex items-center gap-2 rounded-full border border-surface-300 bg-white px-8 py-3.5 text-base font-semibold text-surface-900 transition-all hover:border-surface-400 hover:bg-surface-50"
              >
                See How It Works
              </Link>
            </div>

            {/* Trust indicators */}
            <p className="mt-8 text-sm text-surface-700">
              No credit card required &middot; Setup in 60 seconds &middot;
              SOC 2 compliant infrastructure
            </p>
          </div>
        </div>
      </section>

      {/* Capabilities Section */}
      <section id="features" className="py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-surface-900 sm:text-4xl">
              Four Agents, One Coworker
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-surface-700">
              Each capability is powered by a team of specialized agents working
              together — from spec to delivery, all inside your Slack workspace.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((cap) => (
              <div
                key={cap.title}
                className="group relative rounded-2xl border border-surface-200 bg-white p-6 transition-all hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/5"
              >
                <div
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${cap.iconBg}`}
                >
                  <cap.icon size={24} className={cap.color.split(" ")[1]} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-surface-900">
                  {cap.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-surface-700">
                  {cap.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section className="border-y border-surface-200 bg-surface-50 py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-surface-900 sm:text-4xl">
              Built Different
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-surface-700">
              Not another chatbot wrapper. Klawhub is engineered for real work —
              with agent teams, tool execution, approval flows, and persistent
              memory.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => (
              <div key={i} className="space-y-3">
                <h3 className="text-lg font-semibold text-surface-900">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-surface-700">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-surface-900 sm:text-4xl">
              How It Works
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-surface-700">
              From request to results in four steps. No new tools, no learning
              curve — just Slack.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div key={s.step} className="relative">
                {/* Step number */}
                <div className="mb-4 text-5xl font-black text-surface-100">
                  {s.step}
                </div>
                <h3 className="text-lg font-semibold text-surface-900">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-surface-700">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof / Stats */}
      <section className="border-y border-surface-200 bg-surface-950 py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            {[
              { value: "4", label: "Agent Capabilities" },
              { value: "6+", label: "Integrated Tools" },
              { value: "24/7", label: "Always Available" },
              { value: "0", label: "Context Switching" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-extrabold text-white lg:text-4xl">
                  {stat.value}
                </div>
                <div className="mt-1 text-sm text-surface-300">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl rounded-3xl gradient-bg-subtle p-10 text-center lg:p-16">
            <h2 className="text-3xl font-bold tracking-tight text-surface-900 sm:text-4xl">
              Ready to Meet Your AI Coworker?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-surface-700">
              Install Klawhub in your Slack workspace and start building,
              researching, and creating — all from chat. Free to get started.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/install"
                className="group inline-flex items-center gap-2 rounded-full gradient-bg px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
              >
                Add to Slack — Free
                <ArrowRight
                  size={18}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-full border border-surface-300 bg-white px-8 py-3.5 text-base font-semibold text-surface-900 transition-all hover:border-surface-400 hover:bg-surface-50"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
