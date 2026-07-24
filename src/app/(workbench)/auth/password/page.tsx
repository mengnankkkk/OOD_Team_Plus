"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiMutation } from "@/features/workbench/lib/api";
import { PageHeading } from "@/features/workbench/components/shared";
import { toast } from "sonner";

export default function PasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await apiMutation("/api/v1/auth/password", "PUT", { currentPassword, newPassword });
      toast.success("密码已更新，请重新登录");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="ACCOUNT" title="修改密码" description="这里直接对应 /api/v1/auth/password。" />
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="current-password">当前密码</Label>
            <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">新密码</Label>
            <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button onClick={() => void submit()} disabled={busy}>保存新密码</Button>
        </div>
      </section>
    </div>
  );
}

