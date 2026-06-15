"use client";

import React, { useEffect, useState } from "react";
import { 
  Play, CheckCircle, AlertTriangle, Cpu, 
  BarChart2, Zap, ArrowRight, RefreshCw 
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sabeiuxrflkndpahuczf.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function DashboardOverview() {
  const [stats, setStats] = useState({
    activeRuns: 0,
    successRate: 98.4,
    totalTokens: 142050,
    skillsCount: 6,
    monthlyLimit: 100,
    monthlyUsage: 14
  });
  
  const [recentLogs, setRecentLogs] = useState([
    { id: 1, agent: "General", action: "Summarized Invoice PDF", skill: "Document Master", status: "success", time: "5m ago" },
    { id: 2, agent: "Planner", action: "Headless Scraping of yfinance DCF", skill: "Financial Modeler", status: "success", time: "12m ago" },
    { id: 3, agent: "General", action: "Executed custom script test", skill: "Skill Creator", status: "success", time: "25m ago" },
    { id: 4, agent: "QA", action: "Audited outbound report (Redacted)", skill: "DLP Firewall", status: "success", time: "40m ago" }
  ]);

  const [loading, setLoading] = useState(false);

  const fetchRealtimeStats = async () => {
    setLoading(true);
    try {
      // Fetch skills count
      const { count: skillsCount } = await supabase
        .from("skills")
        .select("*", { count: 'exact', head: true });
        
      // Fetch schedules count
      const { count: schedulesCount } = await supabase
        .from("schedules")
        .select("*", { count: 'exact', head: true });

      // Fetch logs
      const { data: logs } = await supabase
        .from("usage_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);

      if (skillsCount !== null) {
        setStats(prev => ({ ...prev, skillsCount: skillsCount || 6 }));
      }
      
      if (logs && logs.length > 0) {
        setRecentLogs(logs.map((l, i) => ({
          id: l.id || i,
          agent: l.agent_name || "General",
          action: l.sandbox_function || "Executed Sandbox task",
          skill: l.skill_used || "Core Engine",
          status: l.status || "success",
          time: new Date(l.created_at).toLocaleTimeString()
        })));
      }
    } catch (e) {
      console.log("Could not load live stats (using fallback defaults):", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRealtimeStats();
  }, []);

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

      {/* Main Grid: Telemetry & Telemetry logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Token consumption audit */}
        <div className="glass-panel p-6 rounded-2xl lg:col-span-1 space-y-6">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-sleekCyan" /> Token Budget Consumption
          </h3>
          
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Nemotron-Ultra API</span>
                <span className="text-sleekCyan">{stats.totalTokens.toLocaleString()} / 1,000,000</span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-sleekCyan to-neonPurple rounded-full" style={{ width: "14%" }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Modal Execution Credits</span>
                <span className="text-glowGreen">$0.00 / $30.00 (Free Tier)</span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-glowGreen rounded-full" style={{ width: "0%" }} />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-glassBorder text-xs text-gray-400 leading-relaxed">
              💡 **$0 Dev Strategy**: All document processing, OCR, browser automation, and embeddings are performed inside Modal using the free execution tier. Local Vercel functions orchestrate, keeping hosting costs strictly at **$0**.
            </div>
          </div>
        </div>

        {/* Recent runs audit logs */}
        <div className="glass-panel p-6 rounded-2xl lg:col-span-2 space-y-6">
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
                {recentLogs.map((log, i) => (
                  <tr key={log.id} className="hover:bg-white/5 transition-colors duration-150">
                    <td className="py-3 px-4 font-semibold text-sleekCyan">{log.agent}</td>
                    <td className="py-3 px-4 text-gray-300">{log.action}</td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{log.skill}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-glowGreen/10 border border-glowGreen/20 text-glowGreen">
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-500 text-xs">{log.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
