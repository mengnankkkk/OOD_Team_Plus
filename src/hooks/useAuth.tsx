"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useFrontendAuth } from "@/features/frontend-migration/auth";
import { fetchCurrentProfile } from "@/services/profileService";
import type { UserProfile } from "@/types/app/user";

export const useAuth = () => {
  const auth = useFrontendAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!auth.user) {
      setProfile(null);
      return;
    }
    setProfile(await fetchCurrentProfile(auth.user.id));
  }, [auth.user]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  return useMemo(() => {
    const user = auth.user ? {
      id: auth.user.id,
      email: auth.user.username,
      is_anonymous: false,
      user_metadata: { display_name: auth.user.displayName },
      role: auth.user.role,
    } : null;
    return {
      session: user ? { user } : null,
      user,
      profile,
      loading: auth.loading,
      isAnonymous: false,
      refreshProfile,
      async signInWithPassword(username: string, password: string) {
        try { await auth.signIn(username, password); return { error: null }; }
        catch (error) { return { error: error instanceof Error ? error : new Error("登录失败") }; }
      },
      async signUpWithPassword(username: string, password: string, displayName?: string) {
        try { await auth.signUp(username, password, displayName); return { error: null }; }
        catch (error) { return { error: error instanceof Error ? error : new Error("注册失败") }; }
      },
      signOut: auth.signOut,
    };
  }, [auth, profile, refreshProfile]);
};
