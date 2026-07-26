"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useFrontendAuth } from "@/features/frontend-migration/auth";
import { apiPatch } from "@/features/frontend-migration/api";
import { LOCALE_COOKIE_NAME, type AppLocale } from "@/i18n/config";

export default function LanguageSelector() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("common.language");
  const router = useRouter();
  const auth = useFrontendAuth();
  const [pending, setPending] = useState(false);

  async function changeLocale(nextLocale: AppLocale) {
    if (nextLocale === locale || pending) return;
    setPending(true);
    try {
      if (auth.user) {
        await apiPatch<{ locale: AppLocale }>("/api/v1/profile/locale", { locale: nextLocale });
        await auth.refresh();
      } else {
        document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(nextLocale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("changeFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        value={locale}
        disabled={pending}
        onChange={(event) => void changeLocale(event.target.value as AppLocale)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
      >
        <option value="zh-CN">{t("zhCN")}</option>
        <option value="en-US">{t("enUS")}</option>
      </select>
    </label>
  );
}
