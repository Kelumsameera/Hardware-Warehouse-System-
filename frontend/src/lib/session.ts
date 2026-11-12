// Server-only helpers shared by the session and backend proxy route handlers.
// The JWT lives in an HTTP-only cookie and is never readable by browser JavaScript.

export const SESSION_COOKIE = "wms_session";
export const SESSION_MAX_AGE = 8 * 60 * 60; // matches the backend JWT lifetime (8h)

export const BACKEND_API_URL = (process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api").replace(/\/$/, "");

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    // Secure (HTTPS-only) in production. SESSION_COOKIE_SECURE=false is only for a trusted
    // LAN served over plain HTTP; browsers drop Secure cookies on http:// hosts other than localhost.
    secure: process.env.SESSION_COOKIE_SECURE ? process.env.SESSION_COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

// CSRF protection for cookie-authenticated, state-changing requests:
// the session cookie is SameSite=Strict, and the request must also come from this
// site's own origin and carry the custom header that cross-site forms cannot send.
export function isSameOriginRequest(request: Request) {
  if (request.headers.get("x-wms-request") !== "1") return false;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function forwardedFor(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "";
}
