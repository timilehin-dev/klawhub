"use client";

import { useDashboard } from "./layout";
import {
  Zap,
  FileText,
  Search,
  BarChart3,
  Clock,
  TrendingUp,
  Users,
  CheckCircle2,
  Circle,
  AlertCircle,
  ArrowRight,
  CalendarClock,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

// ── Types ──

interface ActivityItem {
  id: string;
  type: "build" | "document" | "research" | "analytics";
  request: string;
  status: string;
  createdAt: string;
}

interface AgentBreakdown {
  agentName: string;
  calls: number;
  tokens: number;
  avgDurationMs: number;
  failures: number;
}

const typeConfig: Record<string, { icon: typeof Zap; label: string; color: string }> = {
  build: { icon: Zap, label: "Build", color: "text-brand-600 bg-brand-50" },
  document: { icon: FileText, label: "Document", color: "text-purple-600 bg-purple-50" },
  research: { icon: Search, label: "Research", color: "text-emerald-600 bg-emerald-50" },
  analytics: { icon: BarChart3, label: "Analytics", color: "text-amber-600 bg-amber-50" },
};

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  done: { icon: CheckCircle2, color: "text-emerald-500", label: "Completed" },
  error: { icon: AlertCircle, color: "text-red-500", label: "Failed" },
  pending: { icon: Circle, color: "text-surface-400", label: "Pending" },
  pending_approval: { icon: Clock, color: "text-amber-500", label: "Awaiting Approval" },
  processing: { icon: Circle, color: "text-brand-500", label: "Processing" },
  pm: { icon: Circle, color: "text-purple-500", label: "Planning" },
  coding: { icon: Circle, color: "text-blue-500", label: "Building" },
  qa: { icon: Circle, color: "text-orange-500", label: "Testing" },
};

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function DashboardPage() {
  const { data, loading } = useDashboard();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [agentBreakdown, setAgentBreakdown] = useState<AgentBreakdown[]>([]);

  // Fetch activity + usage data for the first member
  useEffect(() => {
    if (!data?.members?.length || !data?.workspace?.id) return;

    const memberId = data.members[0].id;

    Promise.all([
      fetch(`/api/dashboard/activity?memberId=${memberId}`).then((r) => r.json()),
      fetch(`/api/dashboard/usage?memberId=${memberId}`).then((r) => r.json()),
    ])
      .then(([activityData, usageData]) => {
        if (activityData.activities) setActivities(activityData.activities);
        if (usageData.agentBreakdown) setAgentBreakdown(usageData.agentBreakdown);
      })
      .catch(() => {});
  }, [data?.members, data?.workspace?.id]);

  if (loading) return null;

  const workspace = data?.workspace;
  const stats = data?.stats;
  const usage = data?.usage;
  const members = data?.members || [];
  const integrations = data?.integrations || [];

  const totalActions = (stats?.totalRuns || 0) + (stats?.totalTasks || 0);
  const connectedIntegrations = integrations.length + 1; // +1 for Slack (always connected)
  const totalMembers = members.length;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Overview</h1>
          <p className="mt-1 text-sm text-surface-700">
            {workspace?.name || "Workspace"} &middot; {workspace?.plan ? `${workspace.plan.charAt(0).toUpperCase() + workspace.plan.slice(1)} plan` : "Free plan"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/integrations"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-4 py-2.5 text-sm font-medium text-surface-900 transition-all hover:border-brand-200 hover:bg-brand-50/50"
          >
            <TrendingUp size={16} />
            Integrations ({connectedIntegrations})
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-full gradient-bg px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:brightness-110"
          >
            Upgrade Plan
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Zap}
          label="Total Actions"
          value={totalActions}
          color="text-brand-600"
          bg="bg-brand-50"
          sublabel={`${stats?.totalRuns || 0} builds, ${stats?.totalTasks || 0} tasks`}
        />
        <StatCard
          icon={CalendarClock}
          label="Active Schedules"
          value={stats?.activeSchedules || 0}
          color="text-purple-600"
          bg="bg-purple-50"
          sublabel={`of ${stats?.totalSchedules || 0} total`}
        />
        <StatCard
          icon={TrendingUp}
          label="Integrations"
          value={connectedIntegrations}
          color="text-emerald-600"
          bg="bg-emerald-50"
          sublabel="Slack + optional"
        />
        <StatCard
          icon={Users}
          label="Team Members"
          value={totalMembers}
          color="text-amber-600"
          bg="bg-amber-50"
          sublabel={`${members.filter((m) => m.isWorkspaceAdmin).length} admins`}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Usage Progress */}
        <div className="rounded-xl border border-surface-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-surface-900">Usage This Month</h2>
          {usage ? (
            <div className="mt-6">
              <div className="flex items-end justify-between">
                <span className="text-4xl font-bold text-surface-900">{usage.used}</span>
                <span className="text-sm text-surface-700">of {usage.limit}</span>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-100">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usage.used >= usage.limit
                      ? "bg-red-500"
                      : usage.used >= usage.limit * 0.8
                      ? "bg-amber-500"
                      : "bg-brand-500"
                  }`}
                  style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                />
              </div>
              <p className={`mt-2 text-sm ${usage.allowed ? "text-emerald-600" : "text-red-600"}`}>
                {usage.allowed
                  ? `${usage.limit - usage.used} remaining`
                  : "Limit reached — upgrade your plan"}
              </p>

              {/* Agent breakdown */}
              {agentBreakdown.length > 0 && (
                <div className="mt-6 space-y-3">
                  <h3 className="text-sm font-medium text-surface-700">By Agent</h3>
                  {agentBreakdown.map((agent) => (
                    <div key={agent.agentName} className="flex items-center justify-between">
                      <span className="text-sm text-surface-700">{agent.agentName}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-surface-500">
                          {(agent.tokens / 1000).toFixed(1)}k tokens
                        </span>
                        <span className="text-sm font-medium text-surface-900">
                          {agent.calls} calls
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 flex items-center justify-center py-8">
              <p className="text-sm text-surface-500">No usage data yet</p>
            </div>
          )}
          <div className="mt-4">
            <Link
              href="/pricing"
              className="text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              View Plans <ArrowRight size={14} className="inline" />
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 rounded-xl border border-surface-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-surface-900">Recent Activity</h2>
          {activities.length > 0 ? (
            <div className="mt-4 divide-y divide-surface-100">
              {activities.slice(0, 8).map((item) => {
                const cfg = typeConfig[item.type] || typeConfig.build;
                const statusCfg = statusConfig[item.status] || statusConfig.pending;
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={item.id} className="flex items-center gap-4 py-3">
                    <div className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.color}`}>
                      <cfg.icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium text-surface-700">
                          {cfg.label}
                        </span>
                        <StatusIcon size={14} className={statusCfg.color} />
                      </div>
                      <p className="mt-0.5 truncate text-sm text-surface-900">{item.request}</p>
                    </div>
                    <span className="shrink-0 text-xs text-surface-500">{timeAgo(item.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-dashed border-surface-300 p-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-100">
                <Zap size={20} className="text-surface-400" />
              </div>
              <p className="text-sm font-medium text-surface-700">No activity yet</p>
              <p className="mt-1 text-xs text-surface-500">
                Mention @Klawhub in Slack or use /klawhub to get started.
              </p>
            </div>
          )}

          {/* Quick actions at bottom */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(typeConfig).map(([key, cfg]) => (
              <Link
                key={key}
                href="/install"
                className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-200 p-3 text-center transition-all hover:border-brand-200 hover:bg-brand-50/50"
              >
                <cfg.icon size={18} className="text-surface-600" />
                <span className="text-xs font-medium text-surface-700">{cfg.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Team Members */}
      {members.length > 0 && (
        <div className="rounded-xl border border-surface-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-surface-900">Team Members</h2>
            <span className="rounded-full bg-surface-100 px-2.5 py-0.5 text-xs font-medium text-surface-700">
              {members.length}
            </span>
          </div>
          <div className="mt-4 divide-y divide-surface-100">
            {members.slice(0, 10).map((member) => (
              <div key={member.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700">
                    {(member.slackUserName || member.slackUserId).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900">
                      {member.slackUserName || member.slackUserId}
                      {member.isWorkspaceAdmin && (
                        <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                          Admin
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-surface-500">
                  {member.lastActiveAt ? timeAgo(member.lastActiveAt) : "Never active"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stat Card Component ──

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
  sublabel,
}: {
  icon: typeof Zap;
  label: string;
  value: number;
  color: string;
  bg: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
          <Icon size={20} className={color} />
        </div>
        <div>
          <p className="text-2xl font-bold text-surface-900">{value}</p>
          <p className="text-xs text-surface-700">{label}</p>
        </div>
      </div>
      {sublabel && <p className="mt-2 text-xs text-surface-500">{sublabel}</p>}
    </div>
  );
}
