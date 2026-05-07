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
  Sparkles,
  Bot,
  Layers,
  ArrowUpRight,
  ShieldAlert,
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

const typeConfig: Record<string, { icon: typeof Zap; label: string; color: string; shadowColor: string }> = {
  build: { icon: Zap, label: "Build", color: "text-indigo-600 bg-indigo-50", shadowColor: "rgba(99, 102, 241, 0.4)" },
  document: { icon: FileText, label: "Document", color: "text-purple-600 bg-purple-50", shadowColor: "rgba(124, 58, 237, 0.4)" },
  research: { icon: Search, label: "Research", color: "text-emerald-600 bg-emerald-50", shadowColor: "rgba(16, 185, 129, 0.4)" },
  analytics: { icon: BarChart3, label: "Analytics", color: "text-amber-500 bg-amber-50", shadowColor: "rgba(245, 158, 11, 0.4)" },
};

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string; glow: string }> = {
  done: { icon: CheckCircle2, color: "text-emerald-500", label: "Completed", glow: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" },
  error: { icon: AlertCircle, color: "text-red-500", label: "Failed", glow: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" },
  pending: { icon: Circle, color: "text-slate-400", label: "Pending", glow: "bg-slate-400 shadow-[0_0_4px_rgba(148,163,184,0.4)]" },
  pending_approval: { icon: Clock, color: "text-amber-500", label: "Awaiting Approval", glow: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" },
  processing: { icon: Circle, color: "text-indigo-500", label: "Processing", glow: "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)] animate-pulse" },
  pm: { icon: Circle, color: "text-purple-500", label: "Planning Spec", glow: "bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)] animate-pulse" },
  coding: { icon: Circle, color: "text-blue-500", label: "Building Code", glow: "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse" },
  qa: { icon: Circle, color: "text-orange-500", label: "Testing & QA", glow: "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse" },
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
    <div className="space-y-8 pb-12 text-slate-800">
      {/* Dynamic Neomorphic Custom CSS styling */}
      <style jsx global>{`
        .silk-raised {
          background: #f1f3f9;
          box-shadow: 6px 6px 14px rgba(163, 177, 198, 0.45), -6px -6px 14px rgba(255, 255, 255, 0.85);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.4);
        }
        .silk-inset {
          background: #f1f3f9;
          box-shadow: inset 4px 4px 10px rgba(163, 177, 198, 0.4), inset -4px -4px 10px rgba(255, 255, 255, 0.85);
          border-radius: 16px;
        }
        .silk-inset-thin {
          background: #f1f3f9;
          box-shadow: inset 2px 2px 5px rgba(163, 177, 198, 0.3), inset -2px -2px 5px rgba(255, 255, 255, 0.8);
          border-radius: 12px;
        }
        .silk-btn-raised {
          background: #f1f3f9;
          box-shadow: 4px 4px 8px rgba(163, 177, 198, 0.4), -4px -4px 8px rgba(255, 255, 255, 0.9);
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.5);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .silk-btn-raised:hover {
          box-shadow: 2px 2px 4px rgba(163, 177, 198, 0.35), -2px -2px 4px rgba(255, 255, 255, 0.8);
          transform: translateY(1px);
        }
        .silk-btn-raised:active {
          box-shadow: inset 3px 3px 6px rgba(163, 177, 198, 0.4), inset -3px -3px 6px rgba(255, 255, 255, 0.85);
          transform: translateY(1px);
        }
        .silk-pill {
          background: #f1f3f9;
          box-shadow: 3px 3px 6px rgba(163, 177, 198, 0.3), -3px -3px 6px rgba(255, 255, 255, 0.8);
          border-radius: 9999px;
        }
        .silk-dot {
          box-shadow: 0 0 10px currentcolor;
        }
      `}</style>

      {/* Page Header */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between p-6 silk-raised bg-[#f1f3f9]">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center bg-indigo-600 text-white shadow-lg shadow-indigo-500/30">
            <Bot size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-slate-800">Mission Control</h1>
              <span className="animate-pulse flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            </div>
            <p className="mt-0.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {workspace?.name || "Workspace"} &middot; {workspace?.plan ? `${workspace.plan} tier` : "Free tier"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/integrations"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-slate-700 uppercase tracking-wider silk-btn-raised bg-[#f1f3f9]"
          >
            <TrendingUp size={14} className="text-indigo-600" />
            Integrations ({connectedIntegrations})
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white uppercase tracking-wider rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 shadow-md shadow-indigo-500/25 transition-all hover:brightness-110 hover:-translate-y-0.5 hover:shadow-indigo-500/40"
          >
            <Sparkles size={14} />
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
          color="text-indigo-600"
          sublabel={`${stats?.totalRuns || 0} builds, ${stats?.totalTasks || 0} tasks`}
        />
        <StatCard
          icon={CalendarClock}
          label="Active Schedules"
          value={stats?.activeSchedules || 0}
          color="text-purple-600"
          sublabel={`of ${stats?.totalSchedules || 0} configured`}
        />
        <StatCard
          icon={TrendingUp}
          label="Connected Apps"
          value={connectedIntegrations}
          color="text-emerald-600"
          sublabel="Active Slack workspace"
        />
        <StatCard
          icon={Users}
          label="Team Members"
          value={totalMembers}
          color="text-amber-500"
          sublabel={`${members.filter((m) => m.isWorkspaceAdmin).length} admins active`}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        
        {/* Left Column - LLM Usage Circular Metrics */}
        <div className="silk-raised bg-[#f1f3f9] p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-200/50">
              <h2 className="text-md font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
                <Layers size={18} className="text-indigo-600" />
                LLM Resource Allocation
              </h2>
              <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Usage</span>
            </div>

            {usage ? (
              <div className="mt-6 space-y-6">
                <div className="flex items-center justify-between p-4 silk-inset">
                  <div>
                    <p className="text-sm font-bold text-slate-700">Compute Token Pool</p>
                    <p className="text-xs text-slate-500 mt-0.5">Renewals on invoice billing date</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-indigo-600">{usage.used}</span>
                    <span className="text-xs font-bold text-slate-400 block">/ {usage.limit}</span>
                  </div>
                </div>

                {/* Silk Neomorphic Progress Bar */}
                <div className="p-3 silk-inset-thin">
                  <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r from-indigo-500 to-violet-500`}
                      style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Simulated Compute Engine Split */}
                <div className="mt-6 space-y-4">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estimated Model Allocations</h3>
                  
                  {/* GPT-4 Circular SVG Progress Row */}
                  <div className="flex items-center justify-between p-3 silk-inset-thin">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full flex items-center justify-center silk-pill">
                        <span className="text-xs font-black text-indigo-600">G4</span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">GPT-4 Omni</p>
                        <p className="text-[10px] text-slate-500">Autonomous Spec & QA</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-slate-800">55%</span>
                      <svg className="w-6 h-6 transform -rotate-90">
                        <circle cx="12" cy="12" r="9" className="stroke-slate-200 fill-none" strokeWidth="2.5" />
                        <circle cx="12" cy="12" r="9" className="stroke-indigo-600 fill-none" strokeWidth="2.5" strokeDasharray="56" strokeDashoffset="25" />
                      </svg>
                    </div>
                  </div>

                  {/* Claude 3 Progress Row */}
                  <div className="flex items-center justify-between p-3 silk-inset-thin">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full flex items-center justify-center silk-pill">
                        <span className="text-xs font-black text-purple-600">C3</span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">Claude 3.5 Sonnet</p>
                        <p className="text-[10px] text-slate-500">Engineering Builds</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-slate-800">30%</span>
                      <svg className="w-6 h-6 transform -rotate-90">
                        <circle cx="12" cy="12" r="9" className="stroke-slate-200 fill-none" strokeWidth="2.5" />
                        <circle cx="12" cy="12" r="9" className="stroke-purple-500 fill-none" strokeWidth="2.5" strokeDasharray="56" strokeDashoffset="39" />
                      </svg>
                    </div>
                  </div>

                  {/* Gemini 1.5 Progress Row */}
                  <div className="flex items-center justify-between p-3 silk-inset-thin">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full flex items-center justify-center silk-pill">
                        <span className="text-xs font-black text-emerald-600">G3</span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">Gemini 1.5 Flash</p>
                        <p className="text-[10px] text-slate-500">Deep Web Search</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-slate-800">15%</span>
                      <svg className="w-6 h-6 transform -rotate-90">
                        <circle cx="12" cy="12" r="9" className="stroke-slate-200 fill-none" strokeWidth="2.5" />
                        <circle cx="12" cy="12" r="9" className="stroke-emerald-500 fill-none" strokeWidth="2.5" strokeDasharray="56" strokeDashoffset="48" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex items-center justify-center py-8">
                <p className="text-sm text-slate-500">No usage data yet</p>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200/50">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider hover:text-indigo-700 transition-colors"
            >
              Analyze Plan Details
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>

        {/* Right Columns (2x Grid) - Recent Activities & Agents status */}
        <div className="lg:col-span-2 silk-raised bg-[#f1f3f9] p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-200/50">
              <h2 className="text-md font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
                <Layers size={18} className="text-indigo-600" />
                Active Workflows
              </h2>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Live Logs</span>
            </div>

            {activities.length > 0 ? (
              <div className="mt-4 space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {activities.slice(0, 6).map((item) => {
                  const cfg = typeConfig[item.type] || typeConfig.build;
                  const statusCfg = statusConfig[item.status] || statusConfig.pending;
                  return (
                    <div key={item.id} className="flex items-center gap-4 p-3.5 silk-inset-thin hover:brightness-95 transition-all">
                      <div className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl silk-pill ${cfg.color}`}>
                        <cfg.icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                            {cfg.label}
                          </span>
                          <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700">
                            <span className={`h-2 w-2 rounded-full ${statusCfg.glow}`} />
                            {statusCfg.label}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-800">{item.request}</p>
                      </div>
                      <span className="shrink-0 text-[10px] font-bold text-slate-400">{timeAgo(item.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-6 silk-inset p-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full silk-pill">
                  <Zap size={22} className="text-slate-400" />
                </div>
                <p className="text-xs font-bold text-slate-700">No active workflows</p>
                <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                  Connect Klawhub to your channels, then mention @Klawhub or upload documentation invoices.
                </p>
              </div>
            )}
          </div>

          {/* Quick Sandbox Navigation Buttons */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 pt-4 border-t border-slate-200/50">
            {Object.entries(typeConfig).map(([key, cfg]) => (
              <Link
                key={key}
                href="/install"
                className="flex flex-col items-center gap-2 p-3 text-center silk-btn-raised bg-[#f1f3f9]"
              >
                <cfg.icon size={16} className="text-slate-600" />
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">{cfg.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Team Members & Active Squads Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Active Multi-Agent Squad */}
        <div className="silk-raised bg-[#f1f3f9] p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200/50">
            <h2 className="text-md font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
              <Bot size={18} className="text-indigo-600" />
              Agent Build Squad
            </h2>
            <span className="text-xs font-bold text-indigo-600">Active</span>
          </div>

          <div className="mt-4 space-y-3">
            {[
              { name: "Product Manager Agent", role: "Specifier & Architect", status: "Active", model: "GPT-4" },
              { name: "Software Engineer Agent", role: "Code Writer & Builder", status: "Active", model: "Claude Sonnet" },
              { name: "QA & Testing Agent", role: "Verifier & Test Runner", status: "Idle", model: "GPT-4" },
              { name: "Deep Researcher Agent", role: "RAG & Document Scanner", status: "Active", model: "Gemini Pro" },
            ].map((agent, i) => (
              <div key={i} className="flex items-center justify-between p-3.5 silk-inset-thin">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center silk-pill">
                    <span className="text-xs font-bold text-indigo-600">{agent.name.split(" ")[0].slice(0, 1)}{agent.name.split(" ")[1].slice(0,1)}</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">{agent.name}</p>
                    <p className="text-[10px] text-slate-500">{agent.role}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold ${agent.status === "Active" ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400"}`}>
                    <span className={`h-1 w-1 rounded-full ${agent.status === "Active" ? "bg-indigo-600" : "bg-slate-400"}`} />
                    {agent.status}
                  </span>
                  <span className="block text-[8px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{agent.model}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Team Members List */}
        <div className="silk-raised bg-[#f1f3f9] p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200/50">
            <h2 className="text-md font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
              <Users size={18} className="text-indigo-600" />
              Workspace Members
            </h2>
            <span className="text-xs font-bold text-slate-500 silk-pill px-2.5 py-0.5">{members.length} Members</span>
          </div>

          <div className="mt-4 space-y-3 max-h-[290px] overflow-y-auto pr-1">
            {members.slice(0, 5).map((member) => (
              <div key={member.id} className="flex items-center justify-between p-3.5 silk-inset-thin">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 silk-pill">
                    {(member.slackUserName || member.slackUserId).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">
                      {member.slackUserName || member.slackUserId}
                      {member.isWorkspaceAdmin && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-[9px] font-black tracking-wide text-amber-700 uppercase">
                          Admin
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-slate-400">
                  {member.lastActiveAt ? `Active ${timeAgo(member.lastActiveAt)}` : "Never active"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat Card Component ──

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  sublabel,
}: {
  icon: typeof Zap;
  label: string;
  value: number;
  color: string;
  sublabel?: string;
}) {
  return (
    <div className="silk-raised bg-[#f1f3f9] p-5 flex flex-col justify-between">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl silk-pill">
          <Icon size={18} className={color} />
        </div>
        <div>
          <p className="text-2xl font-black text-slate-800">{value}</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mt-0.5">{label}</p>
        </div>
      </div>
      {sublabel && <p className="mt-3 text-[10px] font-bold text-slate-400 border-t border-slate-200/40 pt-2">{sublabel}</p>}
    </div>
  );
}
