"use client";

import { Bell, KeyRound, LogIn, LogOut, Target, User, WalletCards } from "lucide-react";
import { PageHeading } from "@/features/workbench/components/shared";
import { useNavigate } from "@/features/frontend-migration/router";
import { useAuth } from "@/hooks/useAuth";
import LanguageSelector from "@/components/desktop/LanguageSelector";
import { useTranslations } from "next-intl";

const settingEntries = [
  { path: "/profile", key: "profile", icon: WalletCards },
  { path: "/goals", key: "goals", icon: Target },
  { path: "/auth/password", key: "password", icon: KeyRound },
  { path: "/notification-preference", key: "notifications", icon: Bell },
];

export default function SettingsPage() {
  const t = useTranslations("auth.settings");
  const { profile, user, isAnonymous, signOut } = useAuth();
  const navigate = useNavigate();
  const displayName = profile?.displayName ?? user?.user_metadata.display_name ?? user?.email ?? t("loadingAccount");

  return (
    <div className="page-stack">
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <section className="paper-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-base font-semibold">{t("languageTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("languageDescription")}</p>
        </div>
        <LanguageSelector />
      </section>

      <section className="paper-card p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <User className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{displayName}</h2>
              <p className="truncate text-sm text-muted-foreground">{isAnonymous ? t("guest") : user?.email ?? t("loadingAccount")}</p>
            </div>
          </div>
          <span className="status-chip neutral">{user?.role ?? "USER"}</span>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {settingEntries.map((entry) => {
          const Icon = entry.icon;
          return (
            <button key={entry.path} type="button" onClick={() => navigate(entry.path)} className="paper-card flex items-center gap-4 p-5 text-left">
              <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-background">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <strong className="block truncate">{t(`entries.${entry.key}.label`)}</strong>
                <small className="block truncate text-muted-foreground">{t(`entries.${entry.key}.description`)}</small>
              </span>
            </button>
          );
        })}
      </section>

      <section className="paper-card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-semibold">{t("loggedIn")}</h2>
          <p className="text-sm text-muted-foreground">{isAnonymous ? t("guest") : t("loggedInDescription")}</p>
        </div>
        {isAnonymous ? (
          <button className="button primary" type="button" onClick={() => navigate("/login")}><LogIn className="size-4" />{t("bindAccount")}</button>
        ) : (
          <button className="button ghost text-destructive" type="button" onClick={() => void signOut()}><LogOut className="size-4" />{t("logout")}</button>
        )}
      </section>
    </div>
  );
}
