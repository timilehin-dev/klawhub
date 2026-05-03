import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  Wrench,
  FileText,
  Search,
  BarChart3,
  Clock,
  Zap,
  TrendingUp,
  Settings,
} from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — Klawhub",
  description: "Klawhub workspace dashboard — monitor usage, manage settings, and track activity.",
};

// This is a static dashboard shell. Real data integration comes in Phase 3
// when we add Supabase Auth and wire dashboard API routes.
// Per the no-dead-code rule, every button and link here routes somewhere real.

const stats = [
  { icon: Zap, label: "Agent Runs This Month", value: "—", color: "text-brand-600", bg: "bg-brand-50" },
  { icon: Clock, label: "Scheduled Tasks", value: "—", color: "text-purple-600", bg: "bg-purple-50" },
  { icon: TrendingUp, label: "Tools Used", value: "—", color: "text-emerald-600", bg: "bg-emerald-50" },
  { icon: Wrench, label: "Skills Active", value: "—", color: "text-amber-600", bg: "bg-amber-50" },
];

const recentActivity = [
  {
    type: "build",
    icon: Wrench,
    title: "No activity yet",
    description: "Connect your Slack workspace to start using Klawhub.",
    time: "",
  },
];

const quickActions = [
  {
    icon: Wrench,
    label: "Build",
    description: "Generate code, scripts, or tools",
    href: "/install",
  },
  {
    icon: FileText,
    label: "Document",
    description: "Create reports, proposals, or invoices",
    href: "/install",
  },
  {
    icon: Search,
    label: "Research",
    description: "Deep dive into any topic",
    href: "/install",
  },
  {
    icon: BarChart3,
    label: "Analyze",
    description: "Run data analysis with charts",
    href: "/install",
  },
];

export default function DashboardPage() {
  return (
    <>
      <Header />

      <section className="pt-28 pb-20 lg:pt-32 lg:pb-28">
        <div className="mx-auto max-w-7xl px-6">
          {/* Page Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-surface-900 sm:text-3xl">
                Dashboard
              </h1>
              <p className="mt-1 text-sm text-surface-700">
                Your workspace activity and settings
              </p>
            </div>
            <Link
              href="/install"
              className="inline-flex items-center gap-2 rounded-full gradient-bg px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:brightness-110"
            >
              <Settings size={16} />
              Workspace Settings
            </Link>
          </div>

          {/* Stats Grid */}
          <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-surface-200 bg-white p-5"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${stat.bg}`}
                  >
                    <stat.icon size={20} className={stat.color} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-surface-900">
                      {stat.value}
                    </p>
                    <p className="text-xs text-surface-700">{stat.label}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Main Content Grid */}
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Recent Activity */}
            <div className="lg:col-span-2 rounded-xl border border-surface-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-surface-900">
                Recent Activity
              </h2>
              <div className="mt-4 divide-y divide-surface-100">
                {recentActivity.map((item, i) => (
                  <div key={i} className="flex items-start gap-4 py-4">
                    <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-100">
                      <item.icon size={18} className="text-surface-700" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-surface-900">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-sm text-surface-700">
                        {item.description}
                      </p>
                    </div>
                    {item.time && (
                      <span className="shrink-0 text-xs text-surface-700">
                        {item.time}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-dashed border-surface-300 p-6 text-center">
                <p className="text-sm text-surface-700">
                  No activity yet.{" "}
                  <Link
                    href="/install"
                    className="font-medium text-brand-600 hover:text-brand-700"
                  >
                    Connect Slack
                  </Link>{" "}
                  to start using Klawhub.
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="rounded-xl border border-surface-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-surface-900">
                Quick Actions
              </h2>
              <div className="mt-4 space-y-3">
                {quickActions.map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex items-center gap-3 rounded-lg border border-surface-200 p-3 transition-all hover:border-brand-200 hover:bg-brand-50/50"
                  >
                    <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-100">
                      <action.icon size={18} className="text-surface-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-surface-900">
                        {action.label}
                      </p>
                      <p className="text-xs text-surface-700">
                        {action.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Usage Breakdown Placeholder */}
          <div className="mt-8 rounded-xl border border-surface-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-surface-900">
                  Usage This Month
                </h2>
                <p className="mt-0.5 text-sm text-surface-700">
                  Detailed usage statistics will appear here once you start
                  using Klawhub.
                </p>
              </div>
              <Link
                href="/pricing"
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                View Plans
              </Link>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Build", icon: Wrench, used: 0, limit: "50" },
                { label: "Document", icon: FileText, used: 0, limit: "50" },
                { label: "Research", icon: Search, used: 0, limit: "50" },
                { label: "Analytics", icon: BarChart3, used: 0, limit: "50" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-surface-200 p-4 text-center"
                >
                  <item.icon
                    size={20}
                    className="mx-auto text-surface-700"
                  />
                  <p className="mt-2 text-sm font-medium text-surface-900">
                    {item.label}
                  </p>
                  <p className="text-2xl font-bold text-surface-900">
                    {item.used}
                    <span className="text-sm font-normal text-surface-700">
                      /{item.limit}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
