"use client";

import { FormEvent, useState } from "react";
import { KeyRound, RefreshCw, Search } from "lucide-react";

import { apiPatch, apiPost } from "@/features/frontend-migration/api";
import { useFrontendAuth } from "@/features/frontend-migration/auth";
import { useApiResource } from "@/features/workbench/components/shared";

type AdminUser = { id: string; username: string; displayName: string; role: "USER" | "ADMIN"; status: "ACTIVE" | "DISABLED"; forcePasswordChange: boolean; version: number; createdAt: string };

export default function AdminUsersPage() {
  const auth = useFrontendAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const users = useApiResource<{ items: AdminUser[]; total: number }>(auth.user?.role === "ADMIN" ? `/api/v1/admin/users?limit=100${filter ? `&q=${encodeURIComponent(filter)}` : ""}` : null);
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState<{ username: string; value: string } | null>(null);

  if (auth.user?.role !== "ADMIN") return <div className="state-panel error">此页面仅对管理员开放。</div>;

  async function update(user: AdminUser, body: { role?: AdminUser["role"]; status?: AdminUser["status"] }) {
    setError("");
    try { await apiPatch(`/api/v1/admin/users/${user.id}`, body, user.version); await users.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "更新用户失败"); }
  }

  async function resetPassword(user: AdminUser) {
    setError("");
    try { const result = await apiPost<{ temporaryPassword: string }>(`/api/v1/admin/users/${user.id}/reset-password`, {}); setTemporaryPassword({ username: user.username, value: result.temporaryPassword }); await users.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "重置密码失败"); }
  }

  function search(event: FormEvent) { event.preventDefault(); setFilter(query.trim()); }

  return <div className="page-stack">
    <header className="page-heading"><div><span className="section-kicker">ADMIN / USERS</span><h1>用户管理</h1><p>查询账号、调整角色与状态，并保护最后一个有效管理员。</p></div><button className="button ghost" onClick={() => void users.reload()}><RefreshCw className="size-4" />刷新</button></header>
    <section className="panel">
      <form className="query-toolbar" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="用户名或显示名称" /><button className="button primary" type="submit"><Search className="size-4" />查询</button></form>
      {error || users.error ? <div className="error-banner" role="alert">{error || users.error}<button className="button ghost" onClick={() => void users.reload()}>重试</button></div> : null}
      {temporaryPassword ? <div className="notice-row"><strong>{temporaryPassword.username} 的一次性临时密码</strong><code>{temporaryPassword.value}</code><span>该账号下次登录后必须修改密码。关闭此提示后服务端不会再次返回明文。</span><button className="button ghost" onClick={() => setTemporaryPassword(null)}>关闭</button></div> : null}
      {users.loading ? <div className="state-panel">正在读取用户目录…</div> : null}
      {!users.loading && users.data?.items.length === 0 ? <div className="state-panel">没有匹配用户。</div> : null}
      <div className="table-shell"><table><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>密码</th><th>操作</th></tr></thead><tbody>{users.data?.items.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>@{user.username}</small></td><td><select aria-label={`${user.username}角色`} value={user.role} onChange={(event) => void update(user, { role: event.target.value as AdminUser["role"] })}><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></td><td><span className={`status-chip ${user.status === "ACTIVE" ? "good" : "danger"}`}>{user.status}</span></td><td>{user.forcePasswordChange ? "待修改" : "正常"}</td><td><div className="table-actions"><button className="button ghost" onClick={() => void update(user, { status: user.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>{user.status === "ACTIVE" ? "禁用" : "启用"}</button><button className="button ghost" onClick={() => void resetPassword(user)}><KeyRound className="size-4" />重置密码</button></div></td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
