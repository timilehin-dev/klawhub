"use client";

import React, { useState, useEffect } from "react";
import { 
  Cpu, CheckCircle2, XCircle, Plus, Info, 
  GitFork, Eye, Play, ShieldAlert, Sparkles 
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sabeiuxrflkndpahuczf.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  skill_type: "builtin" | "custom" | "generated";
  activation_status: string;
  ram_gb: number;
  documentation: string;
  test_results?: any;
}

const builtinSkills: Skill[] = [
  { id: "b1", name: "Document Master", slug: "document_master", description: "MIT-licensed doc parsing (pdfplumber), conversion (Pandoc), HTML -> PDF (WeasyPrint), and OCR (PaddleOCR).", skill_type: "builtin", activation_status: "active", ram_gb: 8, documentation: "Uses pdfplumber, pypdf, docx, openpyxl, pptx, reportlab, WeasyPrint, and Pandoc." },
  { id: "b2", name: "Data Science Lab", slug: "data_science", description: "Exploratory analysis, statistical regression, training models, and interactive visualizations (Plotly/Seaborn).", skill_type: "builtin", activation_status: "active", ram_gb: 16, documentation: "Uses pandas, polars, numpy, matplotlib, seaborn, plotly, scikit-learn, scipy, statsmodels." },
  { id: "b3", name: "Financial Modeler", slug: "financial_modeler", description: "Discounted Cash Flows, scenario analysis, yfinance market data, pandas-ta indicators, and FinanceToolkit ratios.", skill_type: "builtin", activation_status: "active", ram_gb: 16, documentation: "Uses yfinance, pandas-ta, FinanceToolkit, openpyxl, WeasyPrint." },
  { id: "b4", name: "FullStack Engineer", slug: "fullstack_engineer", description: "Scaffolding projects, running Pytest, code reviews, formatting (Black), and PR creation via GitPython.", skill_type: "builtin", activation_status: "active", ram_gb: 16, documentation: "Uses pytest, black, pylint, gitpython, cookiecutter." },
  { id: "b5", name: "Research Synthesizer", slug: "research_synthesizer", description: "Multi-step web search (Tavily), citation scoring, footnotes compiler, and Markdown syntheses.", skill_type: "builtin", activation_status: "active", ram_gb: 8, documentation: "Uses tavily-python, markitdown, WeasyPrint." },
  { id: "b6", name: "Scheduler & Automation", slug: "automation_engine", description: "Manage crons, track workspace tasks, trigger event-driven workflows, and automate followups.", skill_type: "builtin", activation_status: "active", ram_gb: 8, documentation: "Uses croniter, pydantic, supabase." }
];

export default function SkillsCatalog() {
  const [skills, setSkills] = useState<Skill[]>(builtinSkills);
  const [githubUrl, setGithubUrl] = useState("");
  const [showInstaller, setShowInstaller] = useState(false);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Skill | null>(null);

  const fetchCustomSkills = async () => {
    try {
      const { data } = await supabase
        .from("skills")
        .select("*")
        .order("created_at", { ascending: false });
        
      if (data && data.length > 0) {
        setSkills([...builtinSkills, ...data as Skill[]]);
      }
    } catch (e) {
      console.log("Could not load custom skills (using built-ins):", e);
    }
  };

  const handleInstallSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubUrl) return;

    setInstallStatus("Triggering Inngest installer queue...");
    try {
      // Simulate/trigger Inngest event by inserting or calling a mock API.
      // In production, Go events API receives webhook or Next.js API dispatches.
      // Here we simulate the trigger.
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "skill_install",
          github_url: githubUrl,
          workspace_id: "test-workspace"
        })
      });
      
      setInstallStatus("Workflow queued. Paste a valid repository with skill_{name}.py, requirements.txt, and SKILL.md. Check dashboard telemetry soon!");
      setGithubUrl("");
    } catch (err) {
      setInstallStatus("Error dispatching skill install workflow.");
    }
  };

  useEffect(() => {
    fetchCustomSkills();
  }, []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-wide">Skills Catalog</h2>
          <p className="text-sm text-gray-400">Workspace capabilities, both built-in and dynamically evolved by KlawHub.</p>
        </div>
        
        <button 
          onClick={() => setShowInstaller(!showInstaller)}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-sleekCyan to-neonPurple text-darkBg font-bold text-sm hover:opacity-95 shadow-[0_0_20px_rgba(0,229,255,0.2)] flex items-center gap-2"
        >
          <Plus className="w-4 h-4 text-darkBg" />
          Install Skill
        </button>
      </div>

      {/* GitHub URL Installer Panel */}
      {showInstaller && (
        <form onSubmit={handleInstallSkill} className="glass-panel p-6 rounded-2xl max-w-2xl space-y-4">
          <h3 className="font-bold flex items-center gap-2 text-sleekCyan">
            <GitFork className="w-4 h-4 text-sleekCyan" /> Install Custom Skill from GitHub
          </h3>
          <p className="text-xs text-gray-400">
            Provide the repository URL. KlawHub will download, run an AST security scan (blocking OS bypasses/dangerous calls), validate it inside the Modal test harness, and queue it for activation.
          </p>
          <div className="flex gap-4">
            <input 
              type="text" 
              placeholder="e.g. https://github.com/user/klawhub-skill-csv-analyzer"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              className="flex-1 bg-white/5 border border-glassBorder rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-sleekCyan"
            />
            <button 
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-sleekCyan text-darkBg font-semibold text-sm hover:bg-sleekCyan/90"
            >
              Queue Install
            </button>
          </div>
          {installStatus && (
            <p className="text-xs text-sleekCyan font-mono bg-sleekCyan/5 p-3 rounded-xl border border-sleekCyan/10">
              {installStatus}
            </p>
          )}
        </form>
      )}

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {skills.map((skill) => (
          <div key={skill.id} className="glass-panel p-6 rounded-2xl flex flex-col justify-between space-y-4 relative overflow-hidden group border border-glassBorder/40 hover:border-sleekCyan/30 transition-all duration-300">
            {skill.skill_type === "generated" && (
              <div className="absolute top-3 right-3 text-glowGreen bg-glowGreen/10 border border-glowGreen/20 px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 uppercase">
                <Sparkles className="w-3 h-3 text-glowGreen" /> Self-Evolved
              </div>
            )}
            
            <div className="space-y-2">
              <h3 className="font-bold text-lg flex items-center gap-2 text-white">
                <Cpu className="w-4 h-4 text-sleekCyan" /> {skill.name}
              </h3>
              <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">{skill.description}</p>
            </div>

            <div className="pt-4 border-t border-glassBorder/30 flex justify-between items-center text-xs">
              <div className="flex gap-2">
                <span className="px-2 py-1 rounded bg-white/5 text-gray-400 font-mono">RAM: {skill.ram_gb}GB</span>
                <span className="px-2 py-1 rounded bg-sleekCyan/10 text-sleekCyan font-semibold">Active</span>
              </div>
              
              <button 
                onClick={() => setSelectedDoc(skill)}
                className="text-sleekCyan hover:underline flex items-center gap-1 font-medium"
              >
                <Eye className="w-3.5 h-3.5" /> Documentation
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Documentation Modal */}
      {selectedDoc && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-panel w-full max-w-2xl rounded-2xl p-8 relative space-y-6 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-glassBorder/50 pb-4">
              <h3 className="font-bold text-xl text-sleekCyan flex items-center gap-2">
                <Cpu className="w-5 h-5 text-sleekCyan" /> {selectedDoc.name} Specs
              </h3>
              <button 
                onClick={() => setSelectedDoc(null)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕ Close
              </button>
            </div>
            
            <div className="space-y-4 text-sm leading-relaxed">
              <div>
                <h4 className="font-bold text-white mb-1">Sandbox Libraries:</h4>
                <p className="text-gray-400 bg-white/5 p-3 rounded-xl border border-glassBorder font-mono text-xs">
                  {selectedDoc.documentation}
                </p>
              </div>
              
              <div>
                <h4 className="font-bold text-white mb-2">Capabilities:</h4>
                <ul className="list-disc pl-5 text-gray-400 space-y-1">
                  <li>Runs strictly inside Isolated Modal container.</li>
                  <li>logical filesystem isolation scoped via `workspace_id`.</li>
                  <li>Directly callable by general cognitive agent node.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
