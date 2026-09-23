// Single place that knows the backend's base URL. Previously every screen
// hardcoded "http://localhost:4000" directly in its own fetch() calls —
// this doesn't change behavior, but it means the URL only needs to change
// in one place (e.g. for deployment), and every screen's real API calls
// are visibly funneled through the same helper rather than sprinkled ad hoc.
const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000";

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Thin fetch wrapper: resolves to parsed JSON on 2xx, throws ApiError
 * otherwise. Every screen still handles its own loading/error state (so
 * empty/error UI stays screen-specific) — this just removes the repeated
 * "check res.ok, throw, parse json" boilerplate and centralizes the base URL.
 */
// credentials: "include" on every call below — required for the session
// cookie to actually be sent (and, on /api/auth/login, received) once the
// frontend and API are on different origins/ports, which is the normal
// case in dev (5173 vs 4000). Centralized here so no individual screen
// has to remember to add it.

// Fired whenever any apiGet/apiPost/apiPatch/apiDelete call gets a 401 —
// i.e. the session is gone (expired, idled out, or logged out elsewhere).
// App.tsx subscribes to this once to bounce back to the login screen,
// instead of every screen having to check for 401 individually.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn;
}

async function handleErrorResponse(res: Response): Promise<never> {
  if (res.status === 401) onUnauthorized?.();
  const body = await res.json().catch(() => ({}));
  throw new ApiError(res.status, body?.error ?? `API ${res.status}`);
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) return handleErrorResponse(res);
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return handleErrorResponse(res);
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export async function apiPatch<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return handleErrorResponse(res);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(apiUrl(path), { method: "DELETE", credentials: "include" });
  if (!res.ok) return handleErrorResponse(res);
}
