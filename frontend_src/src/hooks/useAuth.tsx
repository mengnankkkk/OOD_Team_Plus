import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ?? null };
    },
    async signUpWithPassword(email, password, displayName) {
      const emailRedirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo, data: displayName ? { display_name: displayName } : undefined },
      });
      return { error: error ?? null };
    },
    async signOut() {
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
