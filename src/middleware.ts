import { NextRequest, NextResponse } from "next/server";
import { verifyWorkspaceId, checkRateLimit } from "@/lib/session";

/**
 * Next.js middleware — runs on every matching request.
 *
 * Protects dashboard and integration API routes:
 * - Validates the signed workspace session cookie
 * - Enforces rate limits
 * - Adds x-workspace-id header for downstream route handlers
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Routes that require authenticated workspace session
  const protectedPaths = ["/api/dashboard", "/api/integrations"];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  if (!isProtected) {
    return NextResponse.next();
  }

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";

  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // Session validation
  const sessionCookie = request.cookies.get("klawhub_workspace_id")?.value;
  if (!sessionCookie) {
    // No session cookie — redirect to install page (for page routes) or return 401 (for API routes)
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required. Please install Klawhub first." },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/install", request.url));
  }

  // Verify the signed cookie
  const workspaceId = verifyWorkspaceId(sessionCookie);
  if (!workspaceId) {
    // Invalid/tampered signature — clear the cookie and redirect
    const response = pathname.startsWith("/api/")
      ? NextResponse.json(
          { error: "Session invalid. Please re-authenticate." },
          { status: 401 }
        )
      : NextResponse.redirect(new URL("/install?error=session_invalid", request.url));

    response.cookies.set("klawhub_workspace_id", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  }

  // Valid session — forward with validated workspace ID in header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-validated-workspace-id", workspaceId);
  requestHeaders.set("X-RateLimit-Remaining", String(remaining));

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    "/api/dashboard/:path*",
    "/api/integrations/:path*",
    // Dashboard pages (if added later)
  ],
};
