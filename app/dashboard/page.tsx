"use client";

import React, { useEffect, useState } from "react";
import { 
  Play, CheckCircle, AlertTriangle, Cpu, 
  BarChart2, Zap, ArrowRight, RefreshCw, Terminal 
} from "lucide-react";
import { useAuth } from "./auth-provider";
import { supabase } from "@/lib/supabase";

export default function DashboardOverview() {
  const { session, workspaceId, loading: authLoading } = useAuth();

  const [stats, setStats] = useState({
    activeRuns: 0,
    successRate: 100,
    totalTokens: 0,
    skillsCount: 6,
    monthlyLimit: 100,
    monthlyUsage: 0,
  });
  
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRealtimeStats = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      // Fetch skills count for this workspace
      const { count: skillsCount } = await supabase
        .from("skills")
        .select("*", { count: 'exact', head: true })
        .eq("workspace_id", workspaceId);
        
      // Fetch recent logs for this workspace
      const { data: logs } = await supabase
        .from("usage_logs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(10);

      // Fetch all logs for this workspace to calculate metrics
      const { data: allLogs } = await supabase
        .from("usage_logs")
        .select("status, total_tokens, created_at")
        .eq("workspace_id", workspaceId);

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      let successRate = 100.0;
      let totalTokens = 0;
      let monthlyUsage = 0;

      if (allLogs && allLogs.length > 0) {
        const successCount = allLogs.filter(l => l.status === "success" || l.status === "completed").length;
        successRate = parseFloat(((successCount / allLogs.length) * 100).toFixed(1));
        totalTokens = allLogs.reduce((acc, curr) => acc + (curr.total_tokens || 0), 0);

        // Filter monthly usage by date
        monthlyUsage = allLogs.filter(l => {
          const d = new Date(l.created_at);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        }).length;
      }

      setStats({
        activeRuns: 0,
        successRate,
        totalTokens,
        skillsCount: skillsCount || 6,
        monthlyLimit: 100,
        monthlyUsage,
      });
      
      if (logs) {
        setRecentLogs(logs.map((l: any, i: number) => ({
          id: l.id || i,
          agent: l.agent_name || "General",
          action: l.sandbox_function || "Executed Sandbox task",
          skill: l.skill_used || "Core Engine",
          status: l.status || "success",
          time: l.created_at ? new Date(l.created_at).toLocaleTimeString() : "Just now"
        })));
      }
    } catch (e) {
      console.log("Could not load live stats:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && workspaceId) {
      fetchRealtimeStats();
    }
  }, [authLoading, workspaceId]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto" />
          <p className="text-gray-400 text-sm">No workspace connected. Install KlawHub via Slack first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-wide">Dashboard Telemetry</h2>
          <p className="text-sm text-gray-400">Real-time performance and task execution auditing.</p>
        </div>
        <button 
          onClick={fetchRealtimeStats}
          disabled={loading}
          className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-glassBorder transition-all duration-200 text-sleekCyan flex items-center gap-2 text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh Stats
        </button>
      </div>

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-300">
            <Play className="w-16 h-16 text-sleekCyan" />
          </div>
          <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Active Run Pipelines</p>
          <h3 className="text-3xl font-extrabold mt-2 text-sleekCyan">{stats.activeRuns} <span className="text-xs text-gray-500 font-normal">running</span></h3>
          <p className="text-xs text-gray-500 mt-2">Currently executing Modal sandboxes</p>
        </div>

        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-300">
            <CheckCircle className="w-16 h-16 text-glowGreen" />
          </div>
          <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Success Rate</p>
          <h3 className="text-3xl font-extrabold mt-2 text-glowGreen">{stats.successRate}%</h3>
          <p className="text-xs text-gray-500 mt-2">QA validation & self-correction passing</p>
        </div>

        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-300">
            <Zap className="w-16 h-16 text-neonPurple" />
          </div>
          <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Monthly Run Budget</p>
          <h3 className="text-3xl font-extrabold mt-2 text-neonPurple">
            {stats.monthlyUsage} <span className="text-sm text-gray-400 font-normal">/ {stats.monthlyLimit}</span>
          </h3>
          <p className="text-xs text-gray-500 mt-2">Resets on 1st of next month</p>
        </div>

        <div className="glass-panel p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-300">
            <Cpu className="w-16 h-16 text-sleekCyan" />
          </div>
          <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Registered Skills</p>
          <h3 className="text-3xl font-extrabold mt-2 text-white">{stats.skillsCount}</h3>
          <p className="text-xs text-gray-500 mt-2">6 built-in, 0 dynamically created</p>
        </div>
      </div>

      {/* Main Grid: Telemetry logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-2xl lg:col-span-3 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Terminal className="w-5 h-5 text-neonPurple" /> Live Execution Stream
            </h3>
            <span className="text-xs px-2 py-1 rounded-full bg-sleekCyan/10 border border-sleekCyan/20 text-sleekCyan font-mono">
              Live updates via Realtime
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-glassBorder text-gray-400 font-medium">
                  <th className="py-3 px-4">Agent</th>
                  <th className="py-3 px-4">Action Pipeline</th>
                  <th className="py-3 px-4">Skill Used</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glassBorder/30">
                {recentLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500 font-medium">
                      No recent runs executed. Telemetry stream will populate as your KlawHub agents perform work.
                    </td>
                  </tr>
                ) : (
                  recentLogs.map((log: any, i: number) => (
                    <tr key={log.id} className="hover:bg-white/5 transition-colors duration-150">
                      <td className="py-3 px-4 font-semibold text-sleekCyan">{log.agent}</td>
                      <td className="py-3 px-4 text-gray-300">{log.action}</td>
                      <td className="py-3 px-4 text-gray-400 text-xs">{log.skill}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          log.status === "success" ? "bg-glowGreen/10 border border-glowGreen/20 text-glowGreen"
                          : log.status === "error" ? "bg-red-400/10 border border-red-500/20 text-red-400"
                          : "bg-glowGreen/10 border border-glowGreen/20 text-glowGreen"
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-500 text-xs">{log.time}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}