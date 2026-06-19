import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Supabase Auth Middleware — lives at project root.
 *
 * Protects all /dashboard/* routes by verifying the Supabase session.
 * Unauthenticated users are redirected to the landing page.
 * The session is refreshed on every request to keep it alive.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // Refresh session if expired — required to keep Supabase session alive
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = req.nextUrl;

  // Keep old dashboard URLs working while exposing a flatter console URL model.
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const redirectUrl = req.nextUrl.clone();
    const rest = pathname.replace(/^\/dashboard\/?/, "");
    const legacyMap: Record<string, string> = {
      "": "/overview",
      workflows: "/workflow",
      settings: "/settings",
      skills: "/skills",
      schedules: "/schedules",
      tasks: "/tasks",
      knowledge: "/knowledge",
      usage: "/usage",
    };
    redirectUrl.pathname = legacyMap[rest] || `/overview`;
    return NextResponse.redirect(redirectUrl, 308);
  }

  const protectedPaths = [
    "/overview",
    "/skills",
    "/schedules",
    "/tasks",
    "/workflow",
    "/knowledge",
    "/usage",
    "/settings",
  ];

  // Protect all /dashboard routes
  if (protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    if (!session) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = "/";
      redirectUrl.searchParams.set("reason", "unauthenticated");
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Allow auth callback to pass through
  if (pathname.startsWith("/auth/callback")) {
    return res;
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - /api/* (handled by Go/Python serverless functions)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
