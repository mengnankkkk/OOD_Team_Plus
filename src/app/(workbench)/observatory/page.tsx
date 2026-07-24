"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/features/frontend-migration/api";

export default function ObservatoryPage() {
  const [data, setData] = useState<{ items?: Array<{ id: string; title?: string; body_text?: string; severity?: string }> } | null>(null); const [error, setError] = useState("");
  useEffect(() => { void apiGet<typeof data>("/api/v1/notifications?limit=50").then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "加载提醒失败")); }, []);
  return <div className="page-stack"><header className="page-heading"><div><span className="section-kicker">OBSERVATORY</span><h1>自选与提醒</h1><p>集中管理观察条件、回撤提醒与浮盈提示。</p></div></header><section className="panel">{error ? <div className="error-banner">{error}</div> : null}{data?.items?.length ? data.items.map((item) => <article className="notice-row" key={item.id}><strong>{item.title}</strong><span>{item.body_text}</span><small>{item.severity}</small></article>) : <div className="state-panel">暂无提醒</div>}</section></div>;
}
