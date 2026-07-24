"use client";

export class ApiError extends Error {
  constructor(message: string, public readonly code = "API_ERROR", public readonly status = 500) { super(message); }
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "GET" });
}

export async function apiMutation<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const finalHeaders = { ...headers };
  finalHeaders["Idempotency-Key"] ??= crypto.randomUUID();
  const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("mw_csrf="))?.slice("mw_csrf=".length);
  if (csrf) finalHeaders["X-CSRF-Token"] ??= decodeURIComponent(csrf);
  return apiRequest<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: finalHeaders });
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { code?: string; message?: string } };
  if (!response.ok) throw new ApiError(payload.error?.message ?? `请求失败（${response.status}）`, payload.error?.code, response.status);
  return payload.data as T;
}

export function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0);
}

export function percent(value: unknown, digits = 1): string {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount * 100 : 0).toFixed(digits)}%`;
}

export function shortDate(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
