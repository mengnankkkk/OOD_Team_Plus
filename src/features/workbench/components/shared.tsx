"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../lib/api";

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-heading"><div><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="heading-actions">{actions}</div> : null}</header>;
}

export function MetricCard({ label, value, note, tone = "default" }: { label: string; value: React.ReactNode; note?: string; tone?: "default" | "positive" | "warning" }) {
  return <article className={`metric-card tone-${tone}`}><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</article>;
}

export function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return <span className={`status-chip ${tone}`}>{children}</span>;
}

export function LoadingBlock({ label = "正在读取本地数据" }: { label?: string }) {
  return <div className="state-panel"><LoaderCircle className="spin" size={22} /><p>{label}</p></div>;
}

export function ErrorBlock({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="state-panel error"><AlertTriangle size={22} /><p>{message}</p>{retry ? <button className="button ghost" onClick={retry}><RefreshCw size={14} />重试</button> : null}</div>;
}

export function EmptyBlock({ title, detail }: { title: string; detail: string }) {
  return <div className="state-panel"><CheckCircle2 size={22} /><strong>{title}</strong><p>{detail}</p></div>;
}

export function useApiResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true); setError("");
    try { setData(await apiGet<T>(path)); } catch (reason) { setError(reason instanceof Error ? reason.message : "读取失败"); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

export function Sparkline({ values, tone = "green" }: { values: number[]; tone?: "green" | "orange" }) {
  if (!values.length) return <div className="spark-empty" />;
  const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(max - min, 0.0001);
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${36 - ((value - min) / span) * 30}`).join(" ");
  return <svg className={`sparkline ${tone}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="趋势图"><polyline points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg>;
}
