"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Health = {
  status: "READY" | "DEGRADED" | "NOT_READY";
  checkedAt: string;
  checks: Array<{ name: string; status: "READY" | "DEGRADED" | "NOT_READY"; detail: string }>;
};

export default function SystemHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/health", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({})) as { data?: Health; error?: { message?: string } };
      if (payload.data) setData(payload.data);
      else setError(payload.error?.message ?? `健康检查失败（${response.status}）`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "健康检查失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">SYSTEM HEALTH</span>
          <h1>系统健康</h1>
          <p>展示数据库、PandaData Skill、Python 运行时和外部配置的就绪状态，不展示任何敏感值。</p>
        </div>
        <button className="button ghost" onClick={() => void reload()}><RefreshCw className="size-4" />重新检查</button>
      </header>
      <section className="panel">
        {error ? <div className="error-banner" role="alert">{error}<button className="button ghost" onClick={() => void reload()}>重试</button></div> : null}
        {loading ? <div className="state-panel">正在执行就绪检查...</div> : null}
        {data ? (
          <>
            <div className="metric-grid">
              <article className="metric-card">
                <span>总体状态</span>
                <strong>{data.status}</strong>
                <small>{new Date(data.checkedAt).toLocaleString("zh-CN")}</small>
              </article>
            </div>
            <div className="research-results">
              {data.checks.map((check) => (
                <article key={check.name}>
                  <div className="flex items-center justify-between gap-4">
                    <h2>{check.name}</h2>
                    <span className={`status-chip ${check.status === "READY" ? "good" : check.status === "DEGRADED" ? "warn" : "danger"}`}>{check.status}</span>
                  </div>
                  <p>{check.detail}</p>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
