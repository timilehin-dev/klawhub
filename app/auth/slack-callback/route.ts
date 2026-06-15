import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Slack OAuth callback bridge.
 *
 * After the Go handler at /api/oauth exchanges the Slack code for a bot token
 * and dispatches the workspace/install event, it redirects the user's browser
 * here with query params: slack_user_id, team_id, team_name.
 *
 * This route creates (or reuses) a Supabase Auth user keyed by the Slack user
 * ID and establishes a browser session cookie so the user can access the
 * dashboard without a second login step.
 */
export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const slackUserId = requestUrl.searchParams.get("slack_user_id");
  const teamId = requestUrl.searchParams.get("team_id");
  const teamName = requestUrl.searchParams.get("team_name") || "My Workspace";

  if (!slackUserId || !teamId) {
    return NextResponse.redirect(
      requestUrl.origin + "/?install=denied&reason=missing_slack_params"
    );
  }

  // ── 1. Ensure a Supabase auth user exists for this Slack user ─────────
  // Use the service-role key (server-only) to bypass RLS and create users
  // without requiring email verification.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Deterministic email / password so the same Slack user always maps to
  // one Supabase auth user.
  const email = `slack-${slackUserId}@klawhub.internal`;
  const password = `klawhub-slack-${slackUserId}-${teamId}`;

  // ── 2. Try signing in first — if the user already exists this succeeds ─
  let signInResult = await admin.auth.signInWithPassword({ email, password });

  // If sign-in failed because the user doesn't exist, create them.
  if (signInResult.error) {
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm so no verification email is sent
      user_metadata: {
        slack_user_id: slackUserId,
        workspace_id: teamId,
        workspace_name: teamName,
      },
    });

    if (createErr) {
      console.error("Failed to create Supabase user for Slack user:", createErr);
      return NextResponse.redirect(
        requestUrl.origin + "/?install=denied&reason=user_creation_failed"
      );
    }

    // Now sign in with the newly created user.
    signInResult = await admin.auth.signInWithPassword({ email, password });
  }

  const session = signInResult.data?.session;
  if (!session || signInResult.error) {
    console.error("Failed to sign in for Slack user:", signInResult.error);
    return NextResponse.redirect(
      requestUrl.origin + "/?install=denied&reason=session_creation_failed"
    );
  }

  // ── 3. Set the session cookie via the browser-facing Supabase client ──
  const cookieStore = cookies();
  const browserSupabase = createRouteHandlerClient({ cookies: () => cookieStore });

  await browserSupabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  // ── 4. Redirect to the dashboard ─────────────────────────────────────
  return NextResponse.redirect(
    requestUrl.origin + "/dashboard?install=success&team=" + encodeURIComponent(teamName)
  );
}