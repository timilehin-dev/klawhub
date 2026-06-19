"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LayoutDashboard, Cpu, Calendar, CheckSquare, 
  GitMerge, Settings, BarChart2, BookOpen, Terminal, LogOut
} from "lucide-react";
import { AuthProvider, useAuth } from "./auth-provider";
import { supabase } from "@/lib/supabase";
import { ErrorBoundary } from "./components/ErrorBoundary";

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
}

const sidebarItems: SidebarItem[] = [
  { name: "Overview", href: "/overview", icon: LayoutDashboard },
  { name: "Skills Catalog", href: "/skills", icon: Cpu },
  { name: "Schedules & Crons", href: "/schedules", icon: Calendar },
  { name: "Workspace Tasks", href: "/tasks", icon: CheckSquare },
  { name: "Automations & Workflows", href: "/workflow", icon: GitMerge },
  { name: "Knowledge base", href: "/knowledge", icon: BookOpen },
  { name: "Usage & Telemetry", href: "/usage", icon: BarChart2 },
  { name: "Settings", href: "/settings", icon: Settings }
];

function DashboardContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, workspaceId, loading } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-darkBg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sleekCyan to-neonPurple animate-pulse" />
          <p className="text-sm text-gray-400">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null; // Middleware will redirect
  }

  const userMeta = session.user.user_metadata || {};
  const displayName = userMeta.full_name || userMeta.name || userMeta.email || session.user.email || "User";
  const workspaceName = userMeta.workspace_name || "My Workspace";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="min-h-screen flex text-gray-200">
      {/* Sidebar Navigation */}
      <aside className="w-64 glass-panel border-r border-glassBorder flex flex-col justify-between p-6 z-20">
        <div>
          {/* Logo Brand */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sleekCyan to-neonPurple flex items-center justify-center shadow-[0_0_15px_rgba(0,229,255,0.4)]">
              <Terminal className="w-5 h-5 text-darkBg" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-wider">KLAWHUB</h1>
              <span className="text-xs text-sleekCyan font-medium">Console v2.0</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group text-sm ${
                    isActive 
                      ? "bg-gradient-to-r from-sleekCyan/20 to-neonPurple/10 text-sleekCyan border border-sleekCyan/20" 
                      : "text-gray-400 hover:text-gray-100 hover:bg-white/5"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-sleekCyan" : "text-gray-400 group-hover:text-gray-100"}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Footer info */}
        <div className="pt-4 border-t border-glassBorder text-center space-y-2">
          <p className="text-xs text-gray-500">
            {workspaceId ? `Workspace: ${workspaceId.slice(0, 8)}...` : "No workspace"}
          </p>
          <button 
            onClick={handleSignOut}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-red-400 transition-colors mx-auto"
          >
            <LogOut className="w-3 h-3" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen max-w-full overflow-hidden">
        {/* Header bar */}
        <header className="h-16 glass-panel border-b border-glassBorder flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-3">
            {workspaceId && (
              <>
                <span className="w-2 h-2 rounded-full bg-glowGreen animate-pulse" />
                <span className="text-xs text-gray-400 font-medium">All systems operational</span>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-semibold">{workspaceName}</p>
              <p className="text-xs text-gray-500">{displayName}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-sleekCyan/30 to-neonPurple/30 border border-glassBorder flex items-center justify-center font-bold text-sleekCyan text-sm">
              {initials}
            </div>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-1 p-8 overflow-y-auto z-10">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardContent>{children}</DashboardContent>
    </AuthProvider>
  );
}
