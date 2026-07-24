"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost, FrontendApiError } from "./api";

export type FrontendAuthUser = { id: string; username: string; displayName: string; role: "USER" | "ADMIN"; status: "ACTIVE" | "DISABLED"; forcePasswordChange: boolean };
type AuthState = { user: FrontendAuthUser | null; loading: boolean; signIn: (username: string, password: string) => Promise<void>; signUp: (username: string, password: string, displayName?: string) => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);

export function FrontendAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FrontendAuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try { setUser((await apiGet<{ user: FrontendAuthUser }>("/api/v1/auth/me")).user); } catch (error) { if (error instanceof FrontendApiError && error.status === 401) setUser(null); else throw error; }
  };
  useEffect(() => { void refresh().finally(() => setLoading(false)); }, []);
  const value = useMemo<AuthState>(() => ({ user, loading, refresh, async signIn(username, password) { const result = await apiPost<{ user: FrontendAuthUser }>("/api/v1/auth/login", { username, password }); setUser(result.user); }, async signUp(username, password, displayName) { const result = await apiPost<{ user: FrontendAuthUser }>("/api/v1/auth/register", { username, password, displayName }); setUser(result.user); }, async signOut() { await apiPost<void>("/api/v1/auth/logout"); setUser(null); } }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useFrontendAuth() { const value = useContext(AuthContext); if (!value) throw new Error("FrontendAuthProvider is required"); return value; }
