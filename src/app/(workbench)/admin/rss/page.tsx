"use client";

import { FormEvent, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

import { apiDelete, apiPatch, apiPost } from "@/features/frontend-migration/api";
import { useFrontendAuth } from "@/features/frontend-migration/auth";
import { useApiResource } from "@/features/workbench/components/shared";

type Feed = { id: string; name: string; feedUrl: string; siteUrl: string | null; enabled: boolean; status: string; refreshIntervalMinutes: number; lastSyncedAt: string | null; lastErrorMessage: string | null; version: number };

export default function AdminRssPage() {
  const auth = useFrontendAuth();
  const feeds = useApiResource<{ items: Feed[] }>(auth.user?.role === "ADMIN" ? "/api/v1/admin/rss/feeds" : null);
  const [name, setName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (auth.user?.role !== "ADMIN") return <div className="state-panel error">此页面仅对管理员开放。</div>;

  async function create(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try { await apiPost("/api/v1/admin/rss/feeds", { name: name.trim() || undefined, feedUrl: feedUrl.trim(), enabled: true, refreshIntervalMinutes: 60 }); setName(""); setFeedUrl(""); await feeds.reload(); setNotice("RSS 源已添加。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "添加 RSS 源失败"); }
  }
  async function toggle(feed: Feed) { setError(""); try { await apiPatch(`/api/v1/admin/rss/feeds/${feed.id}`, { enabled: !feed.enabled }, feed.version); await feeds.reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "更新失败"); } }
  async function sync(feed: Feed) { setError(""); setNotice(""); try { await apiPost(`/api/v1/admin/rss/feeds/${feed.id}/sync`, { force: true }); await feeds.reload(); setNotice(`${feed.name} 同步任务已完成。`); } catch (reason) { setError(reason instanceof Error ? reason.message : "同步失败"); } }
  async function remove(feed: Feed) { setError(""); try { await apiDelete(`/api/v1/admin/rss/feeds/${feed.id}`, undefined, feed.version); await feeds.reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); } }

  return <div className="page-stack"><header className="page-heading"><div><span className="section-kicker">ADMIN / RSS</span><h1>RSS 源管理</h1><p>维护公共资讯源、同步周期与上游错误状态。</p></div><button className="button ghost" onClick={() => void feeds.reload()}><RefreshCw className="size-4" />刷新</button></header><section className="panel"><form className="query-toolbar" onSubmit={create}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="来源名称" /><input required type="url" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://example.com/feed.xml" /><button className="button primary" type="submit"><Plus className="size-4" />添加</button></form>{error || feeds.error ? <div className="error-banner" role="alert">{error || feeds.error}<button className="button ghost" onClick={() => void feeds.reload()}>重试</button></div> : null}{notice ? <div className="notice-row">{notice}</div> : null}{feeds.loading ? <div className="state-panel">正在读取 RSS 配置…</div> : null}<div className="table-shell"><table><thead><tr><th>来源</th><th>状态</th><th>同步</th><th>操作</th></tr></thead><tbody>{feeds.data?.items.map((feed) => <tr key={feed.id}><td><strong>{feed.name}</strong><small>{feed.feedUrl}</small>{feed.lastErrorMessage ? <small className="text-destructive">{feed.lastErrorMessage}</small> : null}</td><td><button className={`status-chip ${feed.enabled ? "good" : "neutral"}`} onClick={() => void toggle(feed)}>{feed.enabled ? "ACTIVE" : "DISABLED"}</button></td><td>{feed.lastSyncedAt ? new Date(feed.lastSyncedAt).toLocaleString("zh-CN") : "尚未同步"}</td><td><div className="table-actions"><button className="button ghost" onClick={() => void sync(feed)}><RefreshCw className="size-4" />同步</button><button className="button ghost" aria-label={`删除${feed.name}`} onClick={() => void remove(feed)}><Trash2 className="size-4" /></button></div></td></tr>)}</tbody></table></div></section></div>;
}
