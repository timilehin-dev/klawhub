"use client";

import { useDashboard } from "../layout";
import { useState, useEffect } from "react";
import {
  Globe,
  Chrome,
  Terminal,
  FileCode,
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";

interface SkillItem {
  id: string;
  name: string;
  label: string;
  description: string;
  icon: any;
  category: "research" | "execution" | "generation" | "communication";
  color: string;
  bg: string;
}

const ALL_SKILLS: SkillItem[] = [
  {
    id: "web_search",
    name: "Google Search",
    label: "Google Web Search",
    description: "Allows Klawhub to query search engines in real-time, fetching up-to-date context, documentation, and answers.",
    icon: Globe,
    category: "research",
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-100",
  },
  {
    id: "puppeteer_scraping",
    name: "Puppeteer Web Scraping",
    label: "Puppeteer Web Scraper",
    description: "Enables deep loading, rendering, and parsing of full HTML web pages to extract comprehensive text contents.",
    icon: Chrome,
    category: "research",
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-100",
  },
  {
    id: "python_sandbox",
    name: "Python Sandbox",
    label: "Python Code Sandbox",
    description: "Provides a secure, fully sandboxed execution runtime to safely build, execute, and test complex custom Python scripts.",
    icon: Terminal,
    category: "execution",
    color: "text-indigo-600",
    bg: "bg-indigo-50 border-indigo-100",
  },
  {
    id: "pdf_generator",
    name: "PDF Generator",
    label: "Document Writer (PDF/DOCX)",
    description: "Automates report assembly, generating premium, formatted documents and invoices exported as PDF or Word files.",
    icon: FileCode,
    category: "generation",
    color: "text-purple-600",
    bg: "bg-purple-50 border-purple-100",
  },
  {
    id: "email_dispatch",
    name: "Email Dispatch (Resend)",
    label: "Native Email Delivery",
    description: "Wired into code results — dispatches digests, generated reports, or alerts directly to client emails automatically.",
    icon: Mail,
    category: "communication",
    color: "text-pink-600",
    bg: "bg-pink-50 border-pink-100",
  },
];

export default function SkillsPage() {
  const { data, refresh } = useDashboard();
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data?.workspace?.enabledSkills) {
      setEnabledSkills(data.workspace.enabledSkills);
    }
  }, [data?.workspace]);

  const toggleSkill = async (skillId: string) => {
    let updated: string[];
    if (enabledSkills.includes(skillId)) {
      updated = enabledSkills.filter((id) => id !== skillId);
    } else {
      updated = [...enabledSkills, skillId];
    }

    setEnabledSkills(updated);
    setSaving(skillId);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/dashboard/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledSkills: updated }),
      });

      if (!res.ok) {
        throw new Error("Failed to save skill changes");
      }

      setSuccessMsg(`Capabilities updated successfully!`);
      refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error saving changes");
      // Rollback UI state
      if (enabledSkills.includes(skillId)) {
        setEnabledSkills([...enabledSkills]);
      } else {
        setEnabledSkills(enabledSkills.filter((id) => id !== skillId));
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <div className="inline-flex max-w-fit items-center gap-1.5 rounded-full bg-brand-50 border border-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
          <Sparkles size={12} className="animate-pulse" />
          AI Coworker Capabilities
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-surface-900">
          Agent Skills & Tools
        </h1>
        <p className="text-sm text-surface-700">
          Enable or disable specific tools available to your Klawhub agent. Disabled tools will be completely hidden from the agent&apos;s planning layer, preventing executions.
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

      {/* Skills Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {ALL_SKILLS.map((skill) => {
          const isActive = enabledSkills.includes(skill.id);
          const isSavingThis = saving === skill.id;

          return (
            <div
              key={skill.id}
              className={`flex flex-col justify-between rounded-2xl border bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-md ${
                isActive ? "border-surface-200" : "border-surface-100 opacity-80"
              }`}
            >
              <div className="space-y-4">
                {/* Icon & Toggle */}
                <div className="flex items-start justify-between gap-4">
                  <div className={`rounded-xl border p-3 ${skill.bg} ${skill.color}`}>
                    <skill.icon size={24} />
                  </div>

                  {/* Dynamic Switch */}
                  <button
                    disabled={saving !== null}
                    onClick={() => toggleSkill(skill.id)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isActive ? "bg-brand-600" : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        isActive ? "translate-x-5" : "translate-x-0"
                      } flex items-center justify-center`}
                    >
                      {isSavingThis && (
                        <Loader2 size={10} className="animate-spin text-brand-600" />
                      )}
                    </span>
                  </button>
                </div>

                {/* Info */}
                <div className="space-y-1">
                  <h3 className="font-bold text-surface-900 flex items-center gap-2">
                    {skill.name}
                    {isActive && (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-3xs font-semibold text-emerald-700">
                        Active
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-surface-700 leading-relaxed">
                    {skill.description}
                  </p>
                </div>
              </div>

              {/* Status footer bar */}
              <div className="mt-5 border-t border-surface-100 pt-4 flex items-center justify-between text-3xs text-surface-500 font-medium uppercase tracking-wider">
                <span>Category: {skill.category}</span>
                <span>{isActive ? "Allowed in reasoning loop" : "Blocked"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
