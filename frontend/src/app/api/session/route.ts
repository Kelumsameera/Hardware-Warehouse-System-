import { NextRequest, NextResponse } from "next/server";
import { BACKEND_API_URL, SESSION_COOKIE, forwardedFor, isSameOriginRequest, sessionCookieOptions } from "@/lib/session";

// GET /api/session - returns the signed-in user, validated by the backend.
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: "Not signed in" }, { status: 401 });

  try {
    const response = await fetch(`${BACKEND_API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    const result = NextResponse.json(data, { status: response.status });
    if (response.status === 401) result.cookies.delete(SESSION_COOKIE);
    return result;
  } catch {
    return NextResponse.json({ message: "Warehouse backend is unavailable" }, { status: 502 });
  }
}

// POST /api/session - signs in through the existing backend login endpoint.
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Request origin is not allowed" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ message: "Email and password are required" }, { status: 400 });
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const clientIp = forwardedFor(request);
    if (clientIp) headers["X-Forwarded-For"] = clientIp;

    const response = await fetch(`${BACKEND_API_URL}/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.token !== "string") {
      return NextResponse.json({ message: data.message || "Sign in failed" }, { status: response.status || 500 });
    }

    const result = NextResponse.json({ user: data.user });
    result.cookies.set(SESSION_COOKIE, data.token, sessionCookieOptions());
    return result;
  } catch {
    return NextResponse.json({ message: "Warehouse backend is unavailable" }, { status: 502 });
  }
}

// DELETE /api/session - signs out by removing the session cookie.
export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Request origin is not allowed" }, { status: 403 });
  }
  const result = NextResponse.json({ message: "Signed out" });
  result.cookies.delete(SESSION_COOKIE);
  return result;
}
