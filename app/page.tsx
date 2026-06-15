"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Terminal, Shield, Cpu, RefreshCw, Layers } from "lucide-react";
import { supabase } from "@/lib/supabase";

const SLACK_CLIENT_ID = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://klawhub.xyz";

/**
 * Strip leading "www." so the redirect_uri matches what is configured in the
 * Slack app (e.g. https://klawhub.xyz/api/oauth instead of www.klawhub.xyz).
 */
function getRedirectHost(appUrl: string): string {
  try {
    const u = new URL(appUrl);
    if (u.hostname.startsWith("www.")) {
      u.hostname = u.hostname.slice(4);
    }
    return u.origin;
  } catch {
    // Fallback: strip "www." manually
    return appUrl.replace(/(https?:\/\/)www\./, "$1");
  }
}

function LandingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const install = searchParams.get("install");
    const reason = searchParams.get("reason");
    if (install === "success") {
      setInstallStatus("✅ Slack installed successfully! Redirecting to dashboard...");
    } else if (install === "denied") {
      setInstallStatus(`❌ Slack installation failed. Reason: ${reason || "Unknown"}`);
    } else if (reason === "unauthenticated") {
      setInstallStatus("⚠️ Please log in to access the dashboard.");
    }
  }, [searchParams]);

  // If the user already has a Supabase session, redirect straight to dashboard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!cancelled && session) {
          router.replace("/dashboard");
          return;
        }
      } catch {
        // Not logged in — stay on landing page
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const redirectHost = getRedirectHost(APP_URL);

  const slackOAuthUrl = SLACK_CLIENT_ID
    ? `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=chat:write,commands,channels:history,channels:read,files:read,files:write,im:history,im:read,im:write,users:read,users:read.email&redirect_uri=${encodeURIComponent(redirectHost + "/api/oauth")}`
    : "https://slack.com/oauth/v2/authorize";

  // Show a brief loading indicator while we check auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-darkBg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sleekCyan to-neonPurple animate-pulse" />
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-between p-8 md:p-16 text-gray-200">
      {/* Install status banner */}
      {installStatus && (
        <div className="fixed top-0 left-0 right-0 z-50 p-4 text-center text-sm font-medium bg-sleekCyan/10 border-b border-sleekCyan/20 text-sleekCyan">
          {installStatus}
        </div>
      )}

      {/* Header navbar */}
      <header className="flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sleekCyan to-neonPurple flex items-center justify-center shadow-[0_0_15px_rgba(0,229,255,0.4)]">
            <Terminal className="w-5 h-5 text-darkBg" />
          </div>
          <h1 className="font-bold text-xl leading-none tracking-wider">KLAWHUB</h1>
        </div>
        <Link 
          href="/dashboard" 
          className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-glassBorder transition-all duration-200 text-sm font-medium"
        >
          Console Login
        </Link>
      </header>

      {/* Hero Section */}
      <main className="max-w-4xl mx-auto text-center my-16 z-10 space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sleekCyan/10 border border-sleekCyan/20 text-sleekCyan text-xs font-semibold tracking-wide uppercase">
          🚀 Next-Gen Slack Coworker
        </div>
        
        <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
          A Self-Evolving AI Coworker <br />
          <span className="bg-gradient-to-r from-sleekCyan via-neonPurple to-glowGreen bg-clip-text text-transparent">
            That Actually Handles the Work.
          </span>
        </h2>
        
        <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto font-light leading-relaxed">
          KlawHub autonomously creates capabilities on demand, manages schedules, runs visual browser automations, models finances, and processes documents — all directly through Slack.
        </p>

        {/* CTA Button Block */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
          <a
            href={slackOAuthUrl}
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-sleekCyan to-neonPurple text-darkBg font-bold text-base hover:opacity-95 shadow-[0_0_30px_rgba(0,229,255,0.3)] transition-all duration-300 transform hover:-translate-y-0.5"
          >
            Enter Admin Dashboard
          </a>
          <a
            href={slackOAuthUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-glassPanel hover:bg-white/10 border border-glassBorder transition-all duration-200 font-semibold text-base flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523 2.528 2.528 0 0 1-2.522-2.523 2.528 2.528 0 0 1 2.522-2.52h2.52v2.52zm1.261 0a2.528 2.528 0 0 1 2.52-2.52h5.043a2.528 2.528 0 0 1 2.522 2.52v5.043a2.528 2.528 0 0 1-2.522 2.52H8.823a2.528 2.528 0 0 1-2.52-2.52v-5.043zM8.823 5.043a2.528 2.528 0 0 1 2.52-2.52 2.528 2.528 0 0 1 2.522 2.52v2.52h-2.522a2.528 2.528 0 0 1-2.52-2.52zm0 1.261a2.528 2.528 0 0 1 2.52 2.52v5.043a2.528 2.528 0 0 1-2.522 2.52H3.78a2.528 2.528 0 0 1-2.52-2.52V8.824a2.528 2.528 0 0 1 2.52-2.52h5.043zm10.135 3.78a2.528 2.528 0 0 1 2.522-2.52 2.528 2.528 0 0 1 2.52 2.52v2.52h-2.52a2.528 2.528 0 0 1-2.522-2.52zm-1.262 0a2.528 2.528 0 0 1-2.52 2.52h-5.043a2.528 2.528 0 0 1-2.522-2.52V5.043a2.528 2.528 0 0 1 2.522-2.52h5.043a2.528 2.528 0 0 1 2.52 2.52v5.043zm-3.78 10.135a2.528 2.528 0 0 1-2.52 2.522 2.528 2.528 0 0 1-2.522-2.522v-2.52h2.522a2.528 2.528 0 0 1 2.52 2.52zm0-1.262a2.528 2.528 0 0 1-2.52-2.52v-5.043a2.528 2.528 0 0 1 2.522-2.52h5.043a2.528 2.528 0 0 1 2.52 2.52v5.043h-5.043z"/>
            </svg>
            Add to Slack
          </a>
        </div>
      </main>

      {/* Feature grid */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-6 max-w-6xl mx-auto z-10 w-full">
        <div className="glass-panel p-6 rounded-2xl space-y-3">
          <Shield className="w-8 h-8 text-sleekCyan" />
          <h3 className="font-bold text-lg">Tenant Isolation</h3>
          <p className="text-gray-400 text-sm">Supabase Row Level Security ensures workspaces are logically isolated.</p>
        </div>
        <div className="glass-panel p-6 rounded-2xl space-y-3">
          <Cpu className="w-8 h-8 text-neonPurple" />
          <h3 className="font-bold text-lg">Self-Evolving</h3>
          <p className="text-gray-400 text-sm">Autonomously writes, tests, and deploys custom skills via Modal sandboxes.</p>
        </div>
        <div className="glass-panel p-6 rounded-2xl space-y-3">
          <RefreshCw className="w-8 h-8 text-glowGreen" />
          <h3 className="font-bold text-lg">Automations & Crons</h3>
          <p className="text-gray-400 text-sm">Full CRUD capabilities for crons, workflow events, and standup tasks.</p>
        </div>
        <div className="glass-panel p-6 rounded-2xl space-y-3">
          <Layers className="w-8 h-8 text-sleekCyan" />
          <h3 className="font-bold text-lg">Google & GitHub</h3>
          <p className="text-gray-400 text-sm">Connect Google Workspace and GitHub via real OAuth for calendar, drive, and repos.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center text-xs text-gray-500 pt-8 z-10">
        © 2026 KlawHub Inc. All rights reserved.
      </footer>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>}>
      <LandingContent />
    </Suspense>
  );
}