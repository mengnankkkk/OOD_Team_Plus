"use client";

import { Bell, KeyRound, LogIn, LogOut, Target, User, WalletCards } from "lucide-react";
import { PageHeading } from "@/features/workbench/components/shared";
import { useNavigate } from "@/features/frontend-migration/router";
import { useAuth } from "@/hooks/useAuth";

const settingEntries = [
  { path: "/profile", label: "个人财务档案", description: "资产偏好、风险承受和个人资料", icon: WalletCards },
  { path: "/goals", label: "个人目标档案", description: "目标、期限和进度管理", icon: Target },
  { path: "/auth/password", label: "修改密码", description: "更新当前账号登录密码", icon: KeyRound },
  { path: "/notification-preference", label: "通知偏好", description: "提醒级别与静默时段", icon: Bell },
];

export default function SettingsPage() {
  const { profile, user, isAnonymous, signOut } = useAuth();
  const navigate = useNavigate();
  const displayName = profile?.displayName ?? user?.user_metadata.display_name ?? user?.email ?? "登录中";

  return (
    <div className="page-stack">
      <PageHeading eyebrow="ACCOUNT" title="设置" description="管理当前登录账号、个人档案和通知偏好。" />

      <section className="paper-card p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <User className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{displayName}</h2>
              <p className="truncate text-sm text-muted-foreground">{isAnonymous ? "游客模式" : user?.email ?? "正在读取账号"}</p>
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
                <strong className="block truncate">{entry.label}</strong>
                <small className="block truncate text-muted-foreground">{entry.description}</small>
              </span>
            </button>
          );
        })}
      </section>

      <section className="paper-card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-semibold">登录状态</h2>
          <p className="text-sm text-muted-foreground">{isAnonymous ? "绑定账号后可跨设备使用。" : "退出后需要重新登录才能访问工作台。"}</p>
        </div>
        {isAnonymous ? (
          <button className="button primary" type="button" onClick={() => navigate("/login")}><LogIn className="size-4" />绑定邮箱账号</button>
        ) : (
          <button className="button ghost text-destructive" type="button" onClick={() => void signOut()}><LogOut className="size-4" />退出登录</button>
        )}
      </section>
    </div>
  );
}
