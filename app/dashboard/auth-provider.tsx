"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

interface AuthContextType {
  session: Session | null;
  workspaceId: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  workspaceId: null,
  loading: true,
  refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const resolveWorkspaceId = useCallback(async (sess: Session): Promise<string | null> => {
    // 1. Check user_metadata for workspace_id (set during workspace/install)
    const metaWid = sess.user.user_metadata?.workspace_id;
    if (metaWid) return metaWid;

    // 2. Check app_metadata
    const appWid = sess.user.app_metadata?.workspace_id;
    if (appWid) return appWid;

    // 3. Query workspace_members using slack_user_id from metadata
    const slackUserId = sess.user.user_metadata?.slack_user_id;
    if (!slackUserId) return null;

    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("slack_user_id", slackUserId)
      .limit(1)
      .single();

    if (error || !data) return null;
    return data.workspace_id;
  }, []);

  const loadAuth = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (!currentSession) {
        setSession(null);
        setWorkspaceId(null);
        setLoading(false);
        return;
      }

      setSession(currentSession);
      const wid = await resolveWorkspaceId(currentSession);
      setWorkspaceId(wid);
    } catch (err) {
      console.error("Auth load error:", err);
      setSession(null);
      setWorkspaceId(null);
    } finally {
      setLoading(false);
    }
  }, [resolveWorkspaceId]);

  useEffect(() => {
    loadAuth();

    // Listen for auth state changes (token refresh, sign out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (newSession) {
          setSession(newSession);
          const wid = await resolveWorkspaceId(newSession);
          setWorkspaceId(wid);
        } else {
          setSession(null);
          setWorkspaceId(null);
          router.push("/");
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [loadAuth, resolveWorkspaceId, router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await loadAuth();
  }, [loadAuth]);

  return (
    <AuthContext.Provider value={{ session, workspaceId, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}