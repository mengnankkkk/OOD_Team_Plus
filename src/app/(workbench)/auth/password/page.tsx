"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiMutation } from "@/features/workbench/lib/api";
import { PageHeading } from "@/features/workbench/components/shared";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export default function PasswordPage() {
  const t = useTranslations("auth.password");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await apiMutation("/api/v1/auth/password", "PUT", { currentPassword, newPassword });
      toast.success(t("success"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failure"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="current-password">{t("currentPassword")}</Label>
            <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={t("currentPasswordPlaceholder")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">{t("newPassword")}</Label>
            <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("newPasswordPlaceholder")} />
          </div>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? t("saving") : t("save")}</Button>
        </div>
      </section>
    </div>
  );
}
