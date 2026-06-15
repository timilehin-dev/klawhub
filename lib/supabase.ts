/**
 * Shared Supabase client for browser-side usage.
 *
 * All dashboard pages import from here instead of creating
 * their own clients with hardcoded URLs/keys.
 *
 * ⚠️ The environment variables NEXT_PUBLIC_SUPABASE_URL and
 *    NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in Vercel.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
    "Set them in your Vercel environment variables."
  );
}

/**
 * Singleton Supabase client for browser-side usage.
 * Automatically includes auth session cookies from the browser.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Get the current authenticated user's session.
 * Returns null if not authenticated.
 */
export async function getSupabaseSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;
  return session;
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