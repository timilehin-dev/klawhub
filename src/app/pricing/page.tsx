import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import Link from "next/link";
import { Check, ArrowRight, Minus } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Klawhub",
  description:
    "Simple, transparent pricing. Start free, scale with your team. Klawhub AI coworker pricing.",
};

const plans = [
  {
    name: "Starter",
    price: "Free",
    priceSuffix: "",
    description: "For individuals trying Klawhub",
    highlight: false,
    cta: "Get Started",
    ctaHref: "/install",
    features: [
      { text: "50 agent runs / month", included: true },
      { text: "General chat with tool use", included: true },
      { text: "Web search & page reading", included: true },
      { text: "Memory & knowledge graph", included: true },
      { text: "Up to 3 scheduled tasks", included: true },
      { text: "1 Slack workspace", included: true },
      { text: "Build squad (PM + Engineer + QA)", included: true },
      { text: "Document generation (PDF/DOCX)", included: true },
      { text: "Priority support", included: false },
      { text: "Custom agent configuration", included: false },
    ],
  },
  {
    name: "Pro",
    price: "$29",
    priceSuffix: "/month",
    description: "For teams that build daily",
    highlight: true,
    cta: "Start Pro Trial",
    ctaHref: "/install?plan=pro",
    features: [
      { text: "1,000 agent runs / month", included: true },
      { text: "All Starter capabilities", included: true },
      { text: "Unlimited scheduled tasks", included: true },
      { text: "Advanced analytics agent", included: true },
      { text: "Research with deep citations", included: true },
      { text: "5 Slack workspaces", included: true },
      { text: "Custom slash commands", included: true },
      { text: "Usage analytics dashboard", included: true },
      { text: "Priority support", included: true },
      { text: "Custom agent configuration", included: false },
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    priceSuffix: "",
    description: "For organizations at scale",
    highlight: false,
    cta: "Contact Sales",
    ctaHref: "/install?plan=enterprise",
    features: [
      { text: "Unlimited agent runs", included: true },
      { text: "All Pro capabilities", included: true },
      { text: "Unlimited Slack workspaces", included: true },
      { text: "Custom agent configuration", included: true },
      { text: "Private cloud deployment", included: true },
      { text: "Custom LLM provider", included: true },
      { text: "SSO / SAML integration", included: true },
      { text: "Dedicated support & SLA", included: true },
      { text: "Audit logs & compliance", included: true },
      { text: "On-premise option", included: true },
    ],
  },
];

const faqs = [
  {
    q: "How does the free trial work?",
    a: "The Starter plan is always free — no trial needed. You get 50 agent runs per month with access to all core capabilities. Upgrade to Pro whenever you need more runs, advanced features, or multiple workspaces.",
  },
  {
    q: "What counts as an agent run?",
    a: "An agent run is any request that triggers the agent pipeline — building code, generating a document, conducting research, running analytics, or using the general chat agent with tool use. Simple text replies from the general agent don't count.",
  },
  {
    q: "Can I switch plans anytime?",
    a: "Yes. You can upgrade or downgrade your plan at any time. When upgrading, you get immediate access to the new plan's features. When downgrading, the change takes effect at the end of your billing period.",
  },
  {
    q: "Is my data secure?",
    a: "All Slack communications use HMAC-SHA256 verification. Code execution runs in an isolated sandbox with authentication. Your database is encrypted at rest and in transit. Enterprise plans get additional security controls including SSO, audit logs, and private deployment options.",
  },
  {
    q: "How does Klawhub compare to Viktor / other AI tools?",
    a: "Klawhub is purpose-built for Slack-first teams. Unlike general-purpose AI tools, our multi-agent architecture means specialized agents handle each type of work — from writing specs to testing code. Everything runs inside your existing Slack workflow with no new apps or context switching.",
  },
];

export default function PricingPage() {
  return (
    <>
      <Header />

      <section className="pt-32 pb-20 lg:pt-40 lg:pb-28">
        <div className="mx-auto max-w-7xl px-6">
          {/* Header */}
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight text-surface-900 sm:text-5xl">
              Simple, Transparent Pricing
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-surface-700">
              Start free. Scale as your team grows. No surprises, no hidden fees.
            </p>
          </div>

          {/* Plans */}
          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 transition-all ${
                  plan.highlight
                    ? "border-brand-500 bg-white shadow-xl shadow-brand-500/10 ring-1 ring-brand-500"
                    : "border-surface-200 bg-white hover:border-surface-300 hover:shadow-lg"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center rounded-full gradient-bg px-4 py-1 text-xs font-semibold text-white">
                      Most Popular
                    </span>
                  </div>
                )}

                <div>
                  <h3 className="text-lg font-semibold text-surface-900">
                    {plan.name}
                  </h3>
                  <p className="mt-1 text-sm text-surface-700">
                    {plan.description}
                  </p>
                </div>

                <div className="mt-6 flex items-baseline">
                  <span
                    className={`text-4xl font-extrabold ${plan.highlight ? "text-brand-600" : "text-surface-900"}`}
                  >
                    {plan.price}
                  </span>
                  {plan.priceSuffix && (
                    <span className="ml-1 text-base font-medium text-surface-700">
                      {plan.priceSuffix}
                    </span>
                  )}
                </div>

                <Link
                  href={plan.ctaHref}
                  className={`mt-8 flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all ${
                    plan.highlight
                      ? "gradient-bg text-white shadow-lg shadow-brand-500/25 hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
                      : "border border-surface-300 bg-white text-surface-900 hover:border-surface-400 hover:bg-surface-50"
                  }`}
                >
                  {plan.cta}
                  <ArrowRight size={16} />
                </Link>

                <ul className="mt-8 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature.text} className="flex items-start gap-3">
                      {feature.included ? (
                        <Check
                          size={18}
                          className="mt-0.5 shrink-0 text-brand-500"
                        />
                      ) : (
                        <Minus
                          size={18}
                          className="mt-0.5 shrink-0 text-surface-300"
                        />
                      )}
                      <span
                        className={`text-sm ${feature.included ? "text-surface-700" : "text-surface-400"}`}
                      >
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="border-t border-surface-200 bg-surface-50 py-20 lg:py-28">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-surface-900 sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <div className="mt-12 space-y-8">
            {faqs.map((faq, i) => (
              <div key={i} className="space-y-2">
                <h3 className="text-lg font-semibold text-surface-900">
                  {faq.q}
                </h3>
                <p className="text-sm leading-relaxed text-surface-700">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <h3 className="text-2xl font-bold text-surface-900">
            Ready to get started?
          </h3>
          <p className="mt-2 text-surface-700">
            Install Klawhub in your Slack workspace in under 60 seconds.
          </p>
          <Link
            href="/install"
            className="mt-6 inline-flex items-center gap-2 rounded-full gradient-bg px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
          >
            Add to Slack — Free
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
