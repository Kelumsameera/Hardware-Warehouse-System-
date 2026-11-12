import { NextRequest, NextResponse } from "next/server";
import { BACKEND_API_URL, SESSION_COOKIE, forwardedFor, isSameOriginRequest } from "@/lib/session";

// Forwards /api/backend/<path> to the Express API, adding the bearer token from the
// HTTP-only session cookie. The backend remains the authority for every permission check.

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const PASS_THROUGH_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "retry-after",
  "location",
  "cache-control",
  "pragma",
  "expires",
  "etag",
  "content-length",
  "www-authenticate",
  "x-request-id",
];

async function forward(request: NextRequest, context: RouteContext<"/api/backend/[...path]">) {
  const { path } = await context.params;
  if (!path.length || path.some((segment) => !SAFE_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    return NextResponse.json({ message: "Invalid API path" }, { status: 400 });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: "Your session has expired. Please sign in again." }, { status: 401 });

  if (request.method !== "GET" && !isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Request origin is not allowed" }, { status: 403 });
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  const clientIp = forwardedFor(request);
  if (clientIp) headers["X-Forwarded-For"] = clientIp;

  let response: Response;
  try {
    response = await fetch(`${BACKEND_API_URL}/${path.join("/")}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return NextResponse.json({ message: "Warehouse backend is unavailable" }, { status: 502 });
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of PASS_THROUGH_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  const setCookieValues = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of setCookieValues) {
    responseHeaders.append("set-cookie", cookie);
  }
  const singleSetCookie = response.headers.get("set-cookie");
  if (singleSetCookie && !setCookieValues.length) {
    responseHeaders.set("set-cookie", singleSetCookie);
  }

  const result = new NextResponse(response.status === 204 ? null : response.body, { status: response.status, headers: responseHeaders });
  if (response.status === 401) result.cookies.delete(SESSION_COOKIE);
  return result;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
