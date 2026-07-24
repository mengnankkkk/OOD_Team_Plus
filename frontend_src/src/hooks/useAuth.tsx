import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { ensureProfile, fetchCurrentProfile } from "@/services/profileService";
import type { UserProfile } from "@/types/app/user";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAnonymous: boolean;
  refreshProfile: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithPassword: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const offlineCreatedAt = new Date().toISOString();
const offlineUser = {
  id: "local-demo-user",
  email: "local-demo@example.com",
  is_anonymous: true,
  user_metadata: { display_name: "本地演示" },
} as unknown as User;
const offlineSession = {
  access_token: "offline",
  refresh_token: "offline",
  expires_in: 0,
  token_type: "bearer",
  user: offlineUser,
} as unknown as Session;
const offlineProfile: UserProfile = {
  id: offlineUser.id,
  displayName: "本地演示",
  age: null,
  household: null,
  monthlyIncome: null,
  monthlyExpense: null,
  liabilities: null,
  emergencyTargetMonths: 6,
  riskLevel: "R3",
  riskSubjective: null,
  riskCapacity: null,
  behaviorNotes: null,
  onboardingCompleted: true,
  createdAt: offlineCreatedAt,
  updatedAt: offlineCreatedAt,
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileLoadingRef = useRef(false);
  const anonSigningInRef = useRef(false);

  const loadProfile = async (user: User) => {
    if (profileLoadingRef.current) return;
    profileLoadingRef.current = true;
    try {
      const fallbackName = (user.user_metadata?.display_name as string) || user.email?.split("@")[0] || "访客";
      const prof = await ensureProfile(user.id, fallbackName);
      setProfile(prof);
    } finally {
      profileLoadingRef.current = false;
    }
  };

  const ensureAnonymousSession = async () => {
    if (anonSigningInRef.current) return;
    anonSigningInRef.current = true;
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.error("匿名登录失败", error);
        return;
      }
      if (data.session) setSession(data.session);
    } finally {
      anonSigningInRef.current = false;
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(offlineSession);
      setProfile(offlineProfile);
      setLoading(false);
      return;
    }

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        setSession(data.session);
        setTimeout(() => { loadProfile(data.session!.user); }, 0);
      } else {
        await ensureAnonymousSession();
      }
      setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) {
        setTimeout(() => { loadProfile(next.user); }, 0);
      } else {
        setProfile(null);
        setTimeout(() => { void ensureAnonymousSession(); }, 0);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    isAnonymous: Boolean(session?.user?.is_anonymous),
    async refreshProfile() {
      if (!session?.user) return;
      const fresh = await fetchCurrentProfile(session.user.id);
      if (fresh) setProfile(fresh);
    },
    async signInWithPassword(email, password) {
      if (!isSupabaseConfigured) return { error: new Error("当前为本地演示模式，未接入登录服务") };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ?? null };
    },
    async signUpWithPassword(email, password, displayName) {
      if (!isSupabaseConfigured) return { error: new Error("当前为本地演示模式，未接入注册服务") };
      const emailRedirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo, data: displayName ? { display_name: displayName } : undefined },
      });
      return { error: error ?? null };
    },
    async signOut() {
      if (!isSupabaseConfigured) return;
      await supabase.auth.signOut();
    },
  }), [session, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
