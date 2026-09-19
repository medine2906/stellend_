import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/ratelimit";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Every API call, per client, per minute — generous for the flows, hostile to a script. */
const REQUESTS_PER_MINUTE = 120;
/** Routes that cost us an anchor round trip or a wallet signature get a tighter budget. */
const EXPENSIVE_PER_MINUTE = 12;
const EXPENSIVE_ROUTES = ["/api/auth/token", "/api/auth/challenge", "/api/deposit", "/api/loans/borrow/start", "/api/withdraw"];

function clientKey(req: NextRequest): string {
  // Behind a proxy the first XFF entry is the real client; direct traffic has no header.
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}

/**
 * Rejects a state-changing request whose Origin is not this site. SameSite=Lax cookies
 * already block the classic cross-site form post; this also covers the cases it does
 * not, and costs one header comparison.
 */
function isCrossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // Same-origin fetches from some browsers, and server-to-server callers, send none.
  try {
    return new URL(origin).host !== req.headers.get("host");
  } catch {
    return true;
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (MUTATING_METHODS.has(req.method) && isCrossSite(req)) {
    return NextResponse.json({ error: "Cross-site requests are not accepted" }, { status: 403 });
  }

  // The keeper is called by a scheduler with a bearer token, not by a browser.
  if (pathname.startsWith("/api/keeper/")) return NextResponse.next();

  const expensive = EXPENSIVE_ROUTES.some((route) => pathname.startsWith(route));
  const limit = expensive ? EXPENSIVE_PER_MINUTE : REQUESTS_PER_MINUTE;
  const { allowed, retryAfter } = rateLimit(`${clientKey(req)}:${expensive ? pathname : "all"}`, limit, 60_000);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests; slow down and try again shortly" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
