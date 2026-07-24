export class FrontendApiError extends Error {
  constructor(message: string, public readonly code = "API_ERROR", public readonly status = 500) { super(message); }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET" && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", crypto.randomUUID());
  if (init.method && init.method !== "GET" && typeof document !== "undefined" && !headers.has("X-CSRF-Token")) {
    const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("mw_csrf="))?.slice("mw_csrf=".length);
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  const response = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { code?: string; message?: string } };
  if (!response.ok) throw new FrontendApiError(payload.error?.message ?? `请求失败（${response.status}）`, payload.error?.code, response.status);
  return payload.data as T;
}

export const apiGet = <T>(path: string) => apiRequest<T>(path);
export const apiPost = <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPatch = <T>(path: string, body: unknown, version?: number) => apiRequest<T>(path, { method: "PATCH", headers: version ? { "If-Match": String(version) } : undefined, body: JSON.stringify(body) });
export const apiDelete = <T>(path: string, body?: unknown, version?: number) => apiRequest<T>(path, { method: "DELETE", headers: version ? { "If-Match": String(version) } : undefined, body: body === undefined ? undefined : JSON.stringify(body) });
