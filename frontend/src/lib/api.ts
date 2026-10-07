import { supabase } from "./supabase";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function messageFrom(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors
    const first = detail[0] as { loc?: unknown[]; msg?: string } | undefined;
    if (first?.msg) return `${(first.loc || []).slice(-1)[0] ?? "Field"}: ${first.msg}`;
  }
  if (detail && typeof detail === "object" && "error" in detail) return String((detail as { error: unknown }).error);
  return status >= 500 ? "Something went wrong on the server. Try again." : `Request failed (${status})`;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers, body });
  } catch {
    throw new ApiError("Can't reach the Trust AI API. Check your connection or the API URL.", 0);
  }
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(messageFrom(payload?.detail, res.status), res.status);
  return payload as T;
}

export const apiBase = BASE;
