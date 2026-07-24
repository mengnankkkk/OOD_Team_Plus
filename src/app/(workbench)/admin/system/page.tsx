"use client";

import { RefreshCw } from "lucide-react";

import { useFrontendAuth } from "@/features/frontend-migration/auth";
import { useApiResource } from "@/features/workbench/components/shared";

type Health = { status: "READY" | "DEGRADED" | "NOT_READY"; checkedAt: string; checks: Array<{ name: string; status: "READY" | "DEGRADED" | "NOT_READY"; detail: string }> };

export default function AdminSystemPage() {
  const auth = useFrontendAuth();
  const health = useApiResource<Health>(auth.user?.role === "ADMIN" ? "/api/v1/admin/system" : null);
  if (auth.user?.role !== "ADMIN") return <div className="state-panel error">此页面仅对管理员开放。</div>;
  return <div className="page-stack"><header className="page-heading"><div><span className="section-kicker">ADMIN / SYSTEM</span><h1>系统健康</h1><p>检查数据库、PandaData Skill、Python 运行时和外部配置，不展示任何敏感值。</p></div><button className="button ghost" onClick={() => void health.reload()}><RefreshCw className="size-4" />重新检查</button></header><section className="panel">{health.error ? <div className="error-banner" role="alert">{health.error}<button className="button ghost" onClick={() => void health.reload()}>重试</button></div> : null}{health.loading ? <div className="state-panel">正在执行就绪检查…</div> : null}{health.data ? <><div className="metric-grid"><article className="metric-card"><span>总体状态</span><strong>{health.data.status}</strong><small>{new Date(health.data.checkedAt).toLocaleString("zh-CN")}</small></article></div><div className="research-results">{health.data.checks.map((check) => <article key={check.name}><div className="flex items-center justify-between gap-4"><h2>{check.name}</h2><span className={`status-chip ${check.status === "READY" ? "good" : check.status === "DEGRADED" ? "warn" : "danger"}`}>{check.status}</span></div><p>{check.detail}</p></article>)}</div></> : null}</section></div>;
}
