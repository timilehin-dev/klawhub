"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Plug,
  LogOut,
  ChevronLeft,
  Loader2,
  Zap,
  AlertTriangle,
} from "lucide-react";

// ── Types ──

interface WorkspaceInfo {
  id: string;
  name: string;
  domain: string | null;
  plan: string;
  isActive: boolean;
  installedAt: string | null;
  memberCount: number;
}

interface Stats {
  totalRuns: number;
  runsByStatus: Record<string, number>;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  activeMembers: number;
  totalSchedules: number;
  activeSchedules: number;
}

interface UsageLimit {
  allowed: boolean;
  used: number;
  limit: number;
}

interface Member {
  id: string;
  slackUserId: string;
  slackUserName: string | null;
  isWorkspaceAdmin: boolean;
  lastActiveAt: string | null;
}

interface Integration {
  id: string;
  provider: string;
  status: string;
  externalAccountName: string | null;
  externalAccountEmail: string | null;
  scope: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

interface DashboardData {
  workspace: WorkspaceInfo | null;
  stats: Stats | null;
  usage: UsageLimit | null;
  members: Member[];
  integrations: Integration[];
}

interface DashboardContextValue {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const DashboardContext = createContext<DashboardContextValue>({
  data: null,
  loading: true,
  error: null,
  refresh: () => {},
});

export function useDashboard() {
  return useContext(DashboardContext);
}

// ── Provider ──

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/dashboard/workspace");
      if (!res.ok) throw new Error("Failed to load dashboard");
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return (
    <DashboardContext.Provider value={{ data, loading, error, refresh: fetchDashboard }}>
      {children}
    </DashboardContext.Provider>
  );
}

// ── Sidebar Navigation ──

const navItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
];

function Sidebar({ workspaceName }: { workspaceName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    document.cookie = "klawhub_workspace_id=; path=/; max-age=0";
    document.cookie = "klawhub_workspace_name=; path=/; max-age=0";
    router.push("/install");
  };

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-surface-200 bg-white">
      {/* Workspace header */}
      <div className="flex items-center gap-3 border-b border-surface-200 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-bg">
          <span className="text-lg font-bold text-white">K</span>
        </div>
        <div className="min-w-0 flex-1">
          <Link href="/" className="block text-base font-bold text-surface-900 hover:text-brand-600 transition-colors">
            Klawhub
          </Link>
          <p className="truncate text-xs text-surface-700">{workspaceName}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-surface-700 hover:bg-surface-100 hover:text-surface-900"
                  }`}
                >
                  <item.icon size={18} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-surface-200 px-3 py-4 space-y-1">
        <Link
          href="/install"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-surface-700 hover:bg-surface-100 hover:text-surface-900 transition-all"
        >
          <ChevronLeft size={18} />
          Back to Site
        </Link>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
        >
          <LogOut size={18} />
          Switch Workspace
        </button>
      </div>
    </aside>
  );
}

// ── Main Layout ──

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <LayoutShell>{children}</LayoutShell>
    </DashboardProvider>
  );
}

function LayoutShell({ children }: { children: ReactNode }) {
  const { data, loading, error } = useDashboard();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-brand-500" />
          <p className="text-sm text-surface-700">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data?.workspace) {
    const debug = (data as any)?.debug;

    return (
      <div className="flex h-screen overflow-y-auto items-center justify-center bg-surface-50 py-10">
        <div className="max-w-2xl w-full mx-auto px-4">
          <div className="text-center rounded-2xl border border-surface-200 bg-white p-8 shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle size={28} className="text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-surface-900">No Workspace Connected</h2>
            <p className="mt-2 text-sm text-surface-700">
              Connect your Slack workspace to access the Klawhub dashboard.
              {error && (
                <span className="block mt-2 text-red-600">Error: {error}</span>
              )}
            </p>
            <div className="mt-6 flex flex-wrap gap-4 justify-center">
              <Link
                href="/install"
                className="inline-flex items-center gap-2 rounded-full gradient-bg px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:brightness-110"
              >
                <Zap size={16} />
                Connect Slack
              </Link>
            </div>

            {/* Diagnostic Console */}
            {debug && (
              <div className="mt-8 text-left rounded-xl border border-surface-200 bg-surface-950 p-6 text-xs text-green-400 font-mono overflow-x-auto max-w-full">
                <p className="text-amber-400 font-bold mb-2">⚡ KLAWHUB SERVER TELEMETRY DIAGNOSTICS:</p>
                <pre>{JSON.stringify(debug, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50">
      <Sidebar workspaceName={data.workspace.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
