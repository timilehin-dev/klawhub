"use client";

import React, { useState, useEffect } from "react";
import { Settings, Shield, User, Globe, GitPullRequest, Calendar, Check, RefreshCw } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sabeiuxrflkndpahuczf.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function WorkspaceSettings() {
  const [personaName, setPersonaName] = useState("Klaw");
  const [personaPrompt, setPersonaPrompt] = useState(
    "You are KlawHub, a self-evolving, Slack-first AI coworker. You solve tasks autonomously, run sandbox executions safely, and write reports."
  );
  const [channels, setChannels] = useState("general, development, operations");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [integrations, setIntegrations] = useState({
    google: { connected: false, email: "" },
    github: { connected: false, email: "" }
  });

  const loadIntegrations = async () => {
    try {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("workspace_id", "b3196921-28c3-4cc9-964f-fa775f5b3e6b");
        
      const newIntegrations = {
        google: { connected: false, email: "" },
        github: { connected: false, email: "" }
      };
      
      if (data) {
        data.forEach(item => {
          if (item.provider === "google") {
            newIntegrations.google = { connected: true, email: item.metadata?.email || "developer@organization.org" };
          } else if (item.provider === "github") {
            newIntegrations.github = { connected: true, email: item.metadata?.email || "git-dev@organization.org" };
          }
        });
      }
      setIntegrations(newIntegrations);
    } catch (e) {
      console.log("Error loading integrations:", e);
    }
  };

  const handleConnect = async (provider: string) => {
    const email = window.prompt(`Enter your ${provider} account email to connect:`);
    if (!email) return;
    
    try {
      const { error } = await supabase
        .from("integrations")
        .insert([{
          workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b",
          provider: provider,
          access_token: "mock-token",
          metadata: { email: email }
        }]);
      if (error) throw error;
      loadIntegrations();
    } catch (e) {
      console.log("Connect failed:", e);
    }
  };

  const handleDisconnect = async (provider: string) => {
    if (!confirm(`Are you sure you want to disconnect ${provider}?`)) return;
    try {
      const { error } = await supabase
        .from("integrations")
        .delete()
        .eq("workspace_id", "b3196921-28c3-4cc9-964f-fa775f5b3e6b")
        .eq("provider", provider);
      if (error) throw error;
      loadIntegrations();
    } catch (e) {
      console.log("Disconnect failed:", e);
    }
  };

  const loadSettings = async () => {
    try {
      const { data } = await supabase
        .from("workspaces")
        .select("*")
        .limit(1);
        
      if (data && data.length > 0) {
        const w = data[0];
        setPersonaName(w.persona_name || "Klaw");
        setPersonaPrompt(w.persona_prompt || "");
        if (w.whitelisted_channels) {
          setChannels(w.whitelisted_channels.join(", "));
        }
      }
    } catch (e) {
      console.log("Could not load database settings, using fallbacks:", e);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const channelList = channels.split(",").map(c => c.trim()).filter(Boolean);
      
      const { error } = await supabase
        .from("workspaces")
        .update({
          persona_name: personaName,
          persona_prompt: personaPrompt,
          whitelisted_channels: channelList
        })
        .eq("id", "b3196921-28c3-4cc9-964f-fa775f5b3e6b");

      if (error) throw error;
      setMessage("Settings saved successfully!");
    } catch (err: any) {
      setMessage("Failed to save settings to database.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadIntegrations();
  }, []);

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-wide">Workspace Settings</h2>
        <p className="text-sm text-gray-400">Manage your AI coworker's persona, Slack bounds, and OAuth credentials.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Form: Persona & Bounds */}
        <form onSubmit={handleSave} className="glass-panel p-6 rounded-2xl lg:col-span-2 space-y-4">
          <h3 className="font-bold flex items-center gap-2 text-sleekCyan mb-2">
            <User className="w-4 h-4 text-sleekCyan" /> AI Persona Configuration
          </h3>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Persona Name</label>
            <input 
              type="text" 
              value={personaName} 
              onChange={(e) => setPersonaName(e.target.value)}
              className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">System Instructions Prompt</label>
            <textarea 
              value={personaPrompt} 
              onChange={(e) => setPersonaPrompt(e.target.value)}
              className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white h-28 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Whitelisted Slack Channels (comma-separated)</label>
            <input 
              type="text" 
              value={channels} 
              onChange={(e) => setChannels(e.target.value)}
              className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white font-mono"
            />
            <span className="text-[10px] text-gray-500">Only messages in these channels will trigger KlawHub.</span>
          </div>

          {message && (
            <p className="text-xs text-sleekCyan font-mono bg-sleekCyan/5 p-3 rounded-xl border border-sleekCyan/10">
              {message}
            </p>
          )}

          <button 
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-sleekCyan to-neonPurple text-darkBg font-bold text-sm hover:opacity-95"
          >
            Save Configuration
          </button>
        </form>

        {/* Right Info: OAuth Integrations */}
        <div className="glass-panel p-6 rounded-2xl lg:col-span-1 space-y-6">
          <h3 className="font-bold flex items-center gap-2 text-neonPurple">
            <Shield className="w-4 h-4 text-neonPurple" /> Integrations OAuth
          </h3>
          
          <div className="space-y-4">
            {/* Google OAuth */}
            <div className="p-4 rounded-xl bg-white/5 border border-glassBorder space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm flex items-center gap-2 text-white">
                  <Calendar className="w-4 h-4 text-sleekCyan" /> Google Apps
                </span>
                {integrations.google.connected ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-glowGreen/10 border border-glowGreen/20 text-glowGreen font-bold uppercase">
                    Connected
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-400/10 border border-red-500/20 text-red-400 font-bold uppercase">
                    Disconnected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400">
                {integrations.google.connected 
                  ? `Connected as ${integrations.google.email}` 
                  : "Calendar scheduling and Drive file operations enabled."}
              </p>
              {integrations.google.connected ? (
                <button 
                  onClick={() => handleDisconnect("google")}
                  className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-glassBorder text-xs font-medium text-gray-300"
                >
                  Disconnect
                </button>
              ) : (
                <button 
                  onClick={() => handleConnect("google")}
                  className="w-full py-2 rounded-lg bg-sleekCyan text-darkBg font-bold text-xs hover:opacity-95"
                >
                  Connect Google
                </button>
              )}
            </div>

            {/* GitHub OAuth */}
            <div className="p-4 rounded-xl bg-white/5 border border-glassBorder space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm flex items-center gap-2 text-white">
                  <GitPullRequest className="w-4 h-4 text-neonPurple" /> GitHub Dev
                </span>
                {integrations.github.connected ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-glowGreen/10 border border-glowGreen/20 text-glowGreen font-bold uppercase">
                    Connected
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-400/10 border border-red-500/20 text-red-400 font-bold uppercase">
                    Disconnected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400">
                {integrations.github.connected 
                  ? `Connected as ${integrations.github.email}` 
                  : "Connect to open Pull Requests and create issues autonomously."}
              </p>
              {integrations.github.connected ? (
                <button 
                  onClick={() => handleDisconnect("github")}
                  className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-glassBorder text-xs font-medium text-gray-300"
                >
                  Disconnect
                </button>
              ) : (
                <button 
                  onClick={() => handleConnect("github")}
                  className="w-full py-2 rounded-lg bg-sleekCyan text-darkBg font-bold text-xs hover:opacity-95"
                >
                  Connect GitHub
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
