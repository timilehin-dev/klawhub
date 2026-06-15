import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Supabase Auth Middleware
 *
 * Protects all /dashboard/* routes by verifying the Supabase session.
 * Unauthenticated users are redirected to the landing page with a reason param.
 * The session is also refreshed on every request to keep it alive.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // Refresh session if expired — required to keep Supabase session alive
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = req.nextUrl;

  // Protect all /dashboard routes
  if (pathname.startsWith("/dashboard")) {
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
