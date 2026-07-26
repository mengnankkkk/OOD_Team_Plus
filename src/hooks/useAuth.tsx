"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useFrontendAuth } from "@/features/frontend-migration/auth";
import { fetchCurrentProfile } from "@/services/profileService";
import type { AppLocale } from "@/i18n/config";

export const useAuth = () => {
  const auth = useFrontendAuth();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["profile", auth.user?.id],
    queryFn: () => fetchCurrentProfile(auth.user!.id),
    enabled: Boolean(auth.user),
    staleTime: 30_000,
  });

  const refreshProfile = useCallback(async () => {
    if (!auth.user) return;
    await queryClient.invalidateQueries({ queryKey: ["profile", auth.user.id] });
  }, [auth.user, queryClient]);

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
      profile: profileQuery.data ?? null,
      loading: auth.loading || profileQuery.isLoading,
      profileLoading: profileQuery.isLoading,
      isAnonymous: false,
      refreshProfile,
      async signInWithPassword(username: string, password: string, locale?: AppLocale) {
        try { await auth.signIn(username, password, locale); return { error: null }; }
        catch (error) { return { error: error instanceof Error ? error : new Error("登录失败") }; }
      },
      async signUpWithPassword(username: string, password: string, displayName?: string, locale?: AppLocale) {
        try { await auth.signUp(username, password, displayName, locale); return { error: null }; }
        catch (error) { return { error: error instanceof Error ? error : new Error("注册失败") }; }
      },
      signOut: auth.signOut,
    };
  }, [auth, profileQuery.data, profileQuery.isLoading, refreshProfile]);
};
