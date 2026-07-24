"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

import { useApiResource } from "@/features/workbench/components/shared";

type Feed = { id: string; name: string; description: string | null; lastSyncedAt: string | null };
type Item = { id: string; feedId: string; feedName: string; title: string; summary: string | null; canonicalUrl: string; author: string | null; publishedAt: string | null; categories: string[] };

export default function RssPage() {
  const feeds = useApiResource<{ items: Feed[] }>("/api/v1/rss/feeds?enabled=true&limit=100");
  const [feedId, setFeedId] = useState("");
  const itemsPath = useMemo(() => `/api/v1/rss/items?limit=50${feedId ? `&feedId=${encodeURIComponent(feedId)}` : ""}`, [feedId]);
  const items = useApiResource<{ items: Item[] }>(itemsPath);
  const loading = feeds.loading || items.loading;
  const error = feeds.error || items.error;

  return <div className="page-stack">
    <header className="page-heading"><div><span className="section-kicker">RSS READER</span><h1>市场资讯</h1><p>按已审核的信息源阅读市场动态，数据时间与来源保持可追溯。</p></div><button className="button ghost" onClick={() => { void feeds.reload(); void items.reload(); }}><RefreshCw className="size-4" />刷新</button></header>
    <section className="panel">
      <div className="query-toolbar"><select value={feedId} onChange={(event) => setFeedId(event.target.value)} aria-label="RSS 来源"><option value="">全部来源</option>{feeds.data?.items.map((feed) => <option key={feed.id} value={feed.id}>{feed.name}</option>)}</select></div>
      {error ? <div className="error-banner" role="alert">{error}<button className="button ghost" onClick={() => { void feeds.reload(); void items.reload(); }}>重试</button></div> : null}
      {loading ? <div className="state-panel">正在读取资讯源…</div> : null}
      {!loading && !error && items.data?.items.length === 0 ? <div className="state-panel">当前来源暂无资讯。</div> : null}
      <div className="research-results">{items.data?.items.map((item) => <article key={item.id}><div className="flex items-start justify-between gap-4"><div><small>{item.feedName}{item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleString("zh-CN")}` : ""}</small><h2>{item.title}</h2></div><a href={item.canonicalUrl} target="_blank" rel="noreferrer" aria-label={`打开${item.title}`}><ExternalLink className="size-4" /></a></div><p>{item.summary ?? "该条目未提供摘要。"}</p>{item.categories.length ? <small>{item.categories.join(" · ")}</small> : null}</article>)}</div>
    </section>
  </div>;
}
