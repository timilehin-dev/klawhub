/**
 * Browser-only Supabase client.
 *
 * Security model:
 * - Browser code only receives the anon key and relies on Supabase Auth/RLS.
 * - Service-role access stays server-side only (see lib/supabase-admin.ts).
 * - Dashboard Go APIs should be called with the short-lived Supabase access token
 *   from `authHeader()`; Go handlers verify it before using service-role DB access.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

function assertSupabaseBrowserEnv() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Set them in your Vercel environment variables."
    );
  }
}

/**
 * Singleton Supabase client for browser-side usage.
 * Automatically includes auth session cookies from the browser.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Get the current authenticated user's session.
 * Returns null if not authenticated.
 */
export async function getSupabaseSession() {
  assertSupabaseBrowserEnv();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;
  return session;
}

/**
 * Authorization header for first-party Go API handlers.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const session = await getSupabaseSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Fetch helper for authenticated, first-party dashboard APIs.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...(init.headers || {}),
  };

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Look up the workspace associated with the current user.
 * The user's workspace_id is stored in their user_metadata
 * (set during Slack OAuth registration).
 */
export async function getWorkspaceId(): Promise<string | null> {
  const session = await getSupabaseSession();
  if (!session) return null;
  
  // workspace_id is stored in user metadata by the workspace_installer workflow
  const workspaceId = session.user.user_metadata?.workspace_id;
  if (workspaceId) return workspaceId;

  // Fallback: query the workspace_members table using the user's slack_user_id
  const slackUserId = session.user.user_metadata?.slack_user_id;
  if (!slackUserId) return null;

  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("slack_user_id", slackUserId)
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.workspace_id;
}
