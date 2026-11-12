// Browser-side API helper. All calls go through the Next.js proxy at /api/backend,
// which attaches the session token from the HTTP-only cookie.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(params: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function handleExpiredSession() {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?expired=1&next=${next}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-wms-request": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`/api/backend${path}`, { method, headers, body: payload, cache: "no-store" });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) handleExpiredSession();
    throw new ApiError(data?.message || `Request failed (${response.status})`, response.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, formData: FormData) => request<T>("POST", path, formData),
};

// Downloads a file (e.g. an Excel report) and saves it with the server-provided name.
export async function downloadFile(path: string, fallbackName: string) {
  const response = await fetch(`/api/backend${path}`, { cache: "no-store", headers: { "x-wms-request": "1" } });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 401) handleExpiredSession();
    throw new ApiError(data?.message || `Download failed (${response.status})`, response.status);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const fileName = /filename="?([^";]+)"?/.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

// Unique reference for stock movements. The backend uses it to make submissions idempotent,
// so retrying the same form submission can never post the movement twice.
export function newTransactionReference(prefix: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8).toUpperCase()
    : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${date}-${random}`;
}
