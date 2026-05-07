"use client";

import { useDashboard } from "../layout";
import { useState, useEffect } from "react";
import {
  Bot,
  User,
  Settings2,
  Lock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  TrendingUp,
} from "lucide-react";

export default function SettingsPage() {
  const { refresh } = useDashboard();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forms states
  const [agentName, setAgentName] = useState("Klawhub");
  const [agentPersonality, setAgentPersonality] = useState("");
  const [monthlyRunLimit, setMonthlyRunLimit] = useState(50);
  const [isActive, setIsActive] = useState(true);
  const [plan, setPlan] = useState("free");

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        const res = await fetch("/api/dashboard/settings");
        if (!res.ok) throw new Error("Failed to load settings");
        const json = await res.json();
        
        setAgentName(json.agentName);
        setAgentPersonality(json.agentPersonality);
        setMonthlyRunLimit(json.monthlyRunLimit);
        setIsActive(json.isActive);
        setPlan(json.plan);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Error loading settings");
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName,
          agentPersonality,
          monthlyRunLimit,
          isActive,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to update settings");
      }

      setSuccessMsg("Settings updated successfully! These changes override all defaults.");
      refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-brand-500" />
          <p className="text-sm text-surface-700">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <div className="inline-flex max-w-fit items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
          <Settings2 size={12} />
          Bot Personalization & Limits
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-surface-900">
          Workspace Settings
        </h1>
        <p className="text-sm text-surface-700">
          Customize how Klawhub presents itself and behaves inside your Slack workspace, manage resource budgets, and toggle overall system activity.
        </p>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 animate-fadeIn">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 animate-fadeIn">
          <AlertCircle size={18} className="text-red-600 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        
        {/* Card: Identity */}
        <div className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm space-y-6">
          <h2 className="text-lg font-bold text-surface-900 flex items-center gap-2 border-b border-surface-100 pb-3">
            <Bot size={20} className="text-indigo-600" />
            Agent Identity & Personality
          </h2>

          <div className="grid grid-cols-1 gap-6">
            
            {/* Agent Name */}
            <div className="space-y-2">
              <label htmlFor="agentName" className="block text-sm font-semibold text-surface-950">
                Agent Custom Name
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <User size={16} className="text-surface-700" />
                </div>
                <input
                  type="text"
                  id="agentName"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="block w-full rounded-lg border border-surface-200 bg-surface-50 py-2.5 pl-10 pr-4 text-sm text-surface-900 focus:border-indigo-500 focus:bg-white focus:outline-none transition-all"
                  placeholder="e.g. Klawhub"
                  required
                />
              </div>
              <p className="text-3xs text-surface-700">
                The name the bot will use to identify itself in Slack threads.
              </p>
            </div>

            {/* Custom Personality Description */}
            <div className="space-y-2">
              <label htmlFor="personality" className="block text-sm font-semibold text-surface-950">
                Custom Personality & System Rules (System Prompt Extra)
              </label>
              <textarea
                id="personality"
                rows={5}
                value={agentPersonality}
                onChange={(e) => setAgentPersonality(e.target.value)}
                className="block w-full rounded-lg border border-surface-200 bg-surface-50 px-4 py-2.5 text-sm text-surface-900 focus:border-indigo-500 focus:bg-white focus:outline-none transition-all"
                placeholder="e.g. Always write highly performant python, maintain a professional but friendly tone, and double check Google search results before writing specifications."
              />
              <p className="text-3xs text-surface-700">
                Provide custom instructions, tone preferences, or unique workspace rules. This will be automatically injected into Klawhub&apos;s system prompt, overriding default behavior.
              </p>
            </div>
          </div>
        </div>

        {/* Card: Resource Limits & Plan */}
        <div className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm space-y-6">
          <h2 className="text-lg font-bold text-surface-900 flex items-center gap-2 border-b border-surface-100 pb-3">
            <TrendingUp size={20} className="text-indigo-600" />
            Budget & Safety Limits
          </h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            
            {/* Monthly Budget Input */}
            <div className="space-y-2">
              <label htmlFor="limit" className="block text-sm font-semibold text-surface-950">
                Monthly Run Limit
              </label>
              <input
                type="number"
                id="limit"
                min={1}
                max={500}
                value={monthlyRunLimit}
                onChange={(e) => setMonthlyRunLimit(parseInt(e.target.value) || 50)}
                className="block w-full rounded-lg border border-surface-200 bg-surface-50 px-4 py-2.5 text-sm text-surface-900 focus:border-indigo-500 focus:bg-white focus:outline-none transition-all"
                required
              />
              <p className="text-3xs text-surface-700">
                The total number of task executions or builds allowed per calendar month across your workspace.
              </p>
            </div>

            {/* Plan Display (Read Only) */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-surface-950 flex items-center gap-1.5">
                Workspace Subscription Plan
                <Lock size={12} className="text-surface-700" />
              </label>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800 capitalize flex items-center justify-between">
                <span>{plan} Tier</span>
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-1 text-4xs font-bold text-indigo-700 uppercase tracking-wider">
                  Active
                </span>
              </div>
              <p className="text-3xs text-surface-700">
                Subscription plan is managed globally. Contact support to upgrade your limits.
              </p>
            </div>
          </div>
        </div>

        {/* Card: System Killswitch */}
        <div className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-bold text-surface-900">
                Agent Active Status
              </h3>
              <p className="text-xs text-surface-700">
                Toggling this off instantly puts Klawhub to sleep. The bot will ignore all mentions and DM events inside Slack, and all scheduled tasks will be suspended until turned back on.
              </p>
            </div>

            {/* Custom Toggle Switch */}
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isActive ? "bg-indigo-600" : "bg-slate-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  isActive ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-end gap-4 border-t border-surface-200 pt-6">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-full gradient-bg px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:brightness-110 disabled:opacity-50"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            Save Customize Settings
          </button>
        </div>
      </form>
    </div>
  );
}
