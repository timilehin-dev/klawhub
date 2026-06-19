"use client";

import React, { useState, useEffect } from "react";
import { Settings, Shield, User, Globe, GitPullRequest, Calendar, Check, RefreshCw, AlertTriangle } from "lucide-react";
import { useAuth } from "../auth-provider";
import { apiFetch } from "@/lib/supabase";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://klawhub.xyz";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const GITHUB_CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";

export default function WorkspaceSettings() {
  const { session, workspaceId, loading: authLoading } = useAuth();
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
    if (!workspaceId) return;
    try {
      const data = await apiFetch<any[]>(`/api/dashboard/integrations?workspace_id=${encodeURIComponent(workspaceId)}`);
        
      const newIntegrations = {
        google: { connected: false, email: "" },
        github: { connected: false, email: "" }
      };
      
      if (data) {
        data.forEach((item: any) => {
          if (item.provider === "google") {
            newIntegrations.google = { connected: true, email: item.email || "" };
          } else if (item.provider === "github") {
            newIntegrations.github = { connected: true, email: item.email || "" };
          }
        });
      }
      setIntegrations(newIntegrations);
    } catch (e) {
      console.log("Error loading integrations:", e);
    }
  };

  const handleGoogleConnect = () => {
    if (!GOOGLE_CLIENT_ID) {
      setMessage("Google Client ID not configured. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to env.");
      return;
    }
    const scopes = [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/drive.file",
    ].join(" ");
    
    const redirectUri = `${APP_URL}/api/oauth/google/callback`;
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      access_type: "offline",
      prompt: "consent",
      state: workspaceId || "",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  const handleGitHubConnect = () => {
    if (!GITHUB_CLIENT_ID) {
      setMessage("GitHub Client ID not configured. Add NEXT_PUBLIC_GITHUB_CLIENT_ID to env.");
      return;
    }
    const redirectUri = `${APP_URL}/api/oauth/github/callback`;
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "repo user",
      state: workspaceId || "",
    });
    window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
  };

  const handleDisconnect = async (provider: string) => {
    if (!workspaceId) return;
    if (!confirm(`Are you sure you want to disconnect ${provider}?`)) return;
    try {
      await apiFetch(`/api/dashboard/integrations?workspace_id=${encodeURIComponent(workspaceId)}&provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
      });
      loadIntegrations();
    } catch (e) {
      console.log("Disconnect failed:", e);
    }
  };

  const loadSettings = async () => {
    if (!workspaceId) return;
    try {
      const data = await apiFetch<any[]>(`/api/dashboard/settings?workspace_id=${encodeURIComponent(workspaceId)}&limit=1`);
        
      if (data && data.length > 0) {
        const w = data[0] as any;
        setPersonaName(w.persona_name || "Klaw");
        setPersonaPrompt(w.persona_prompt || "");
        if (w.whitelisted_channels) {
          setChannels(w.whitelisted_channels.join(", "));
        }
      }
    } catch (e) {
      console.log("Could not load database settings:", e);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    setLoading(true);
    setMessage("");

    try {
      const channelList = channels.split(",").map(c => c.trim()).filter(Boolean);
      
      await apiFetch(`/api/dashboard/settings/${workspaceId}?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          persona_name: personaName,
          persona_prompt: personaPrompt,
          whitelisted_channels: channelList
        }),
      });
      setMessage("Settings saved successfully!");
    } catch (err: any) {
      setMessage("Failed to save settings to database.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && workspaceId) {
      loadSettings();
      loadIntegrations();
    }
  }, [authLoading, workspaceId]);

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-500">Loading...</div></div>;
  }

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto" />
          <p className="text-gray-400 text-sm">No workspace connected.</p>
        </div>
      </div>
    );
  }

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
            <p className={`text-xs font-mono p-3 rounded-xl border ${
              message.includes("success") 
                ? "text-sleekCyan bg-sleekCyan/5 border-sleekCyan/10" 
                : "text-red-400 bg-red-400/5 border-red-500/10"
            }`}>
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

        {/* Right: OAuth Integrations */}
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
                  : "Calendar, Drive & Gmail access for scheduling and file operations."}
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
                  onClick={handleGoogleConnect}
                  className="w-full py-2 rounded-lg bg-sleekCyan text-darkBg font-bold text-xs hover:opacity-95"
                >
                  Connect Google Workspace
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
                  : "Pull Requests, Issues, and repository management via OAuth."}
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
                  onClick={handleGitHubConnect}
                  className="w-full py-2 rounded-lg bg-neonPurple text-darkBg font-bold text-xs hover:opacity-95"
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
