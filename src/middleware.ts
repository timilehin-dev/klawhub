import { NextRequest, NextResponse } from "next/server";
import { verifyWorkspaceId, checkRateLimit } from "@/utils/session";

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
  const sessionCookie = request.cookies.get("klawhub_session")?.value;
  if (!sessionCookie) {
    if (pathname.startsWith("/api/")) {
      const cookiesList = request.cookies.getAll().map((c) => `${c.name}=${c.value ? c.value.slice(0, 10) + "..." : "empty"}`).join("; ");
      return NextResponse.json(
        { 
          error: "Authentication required. Please install Klawhub first.",
          debug: {
            reason: "Cookie 'klawhub_session' is missing",
            cookies: cookiesList || "none",
            host: request.headers.get("host") || "unknown",
          }
        },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/install", request.url));
  }

  // Verify the signed cookie
  let verifyError: string | null = null;
  let workspaceId: string | null = null;
  try {
    workspaceId = verifyWorkspaceId(sessionCookie);
    if (!workspaceId) {
      verifyError = "verifyWorkspaceId returned null";
    }
  } catch (err) {
    verifyError = err instanceof Error ? err.message : "Error during verification";
  }

  if (!workspaceId) {
    const host = request.headers.get("host") || "";
    const domain = host.split(":")[0];
    const cookieDomain = domain.endsWith("klawhub.xyz") ? ".klawhub.xyz" : undefined;

    const cookiesList = request.cookies.getAll().map((c) => `${c.name}=${c.value ? c.value.slice(0, 10) + "..." : "empty"}`).join("; ");
    const sessionSecretPresent = !!process.env.SESSION_SECRET;
    const integrationKeyPresent = !!process.env.INTEGRATION_ENCRYPTION_KEY;

    const response = pathname.startsWith("/api/")
      ? NextResponse.json(
          { 
            error: "Session invalid. Please re-authenticate.",
            debug: {
              reason: "Cookie signature verification failed",
              verifyError,
              cookies: cookiesList || "none",
              sessionCookieValue: sessionCookie.slice(0, 10) + "...",
              host,
              env: {
                SESSION_SECRET: sessionSecretPresent,
                INTEGRATION_ENCRYPTION_KEY: integrationKeyPresent,
              }
            }
          },
          { status: 401 }
        )
      : NextResponse.redirect(new URL("/install?error=session_invalid", request.url));

    response.cookies.set("klawhub_session", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
      domain: cookieDomain,
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
