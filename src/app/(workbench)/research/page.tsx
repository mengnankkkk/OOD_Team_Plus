"use client";

import { FormEvent, useState } from "react";
import { Search } from "lucide-react";

import { apiGet, apiPost } from "@/features/frontend-migration/api";

type SearchResult = {
  id: string;
  title: string | null;
  snippet: string | null;
  url: string | null;
  adapter: string;
  source_name?: string | null;
  published_at?: string | null;
};

type SourceStatus = { adapter: string; status: string; result_count: number; error: { message?: string } | null };

export default function ResearchPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || loading) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const created = await apiPost<{ searchId: string }>("/api/v1/research-searches", {
        query: normalized,
        adapters: ["KNOWLEDGE_BASE", "MCP", "RSS"],
        maximumResults: 20,
      });
      const result = await apiGet<{ items: SearchResult[]; sourceStatuses: SourceStatus[] }>(
        `/api/v1/research-searches/${created.searchId}/results`,
      );
      setItems(result.items);
      setSources(result.sourceStatuses);
    } catch (reason) {
      setItems([]);
      setSources([]);
      setError(reason instanceof Error ? reason.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div><span className="section-kicker">RESEARCH RADAR</span><h1>信息搜索</h1><p>聚合知识库、MCP 与 RSS；研究结果只作为证据，不直接生成交易指令。</p></div>
      </header>
      <section className="panel">
        <form className="query-toolbar" onSubmit={search}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索市场、公司或主题" aria-label="研究主题" />
          <button className="button primary" type="submit" disabled={loading || !query.trim()}><Search className="size-4" />{loading ? "搜索中" : "搜索"}</button>
        </form>
        {sources.length > 0 ? <div className="status-strip">{sources.map((source) => <span key={source.adapter}>{source.adapter} · {source.status} · {source.result_count} 条</span>)}</div> : null}
        {error ? <div className="error-banner" role="alert">{error}<button className="button ghost" onClick={(event) => void search(event)}>重试</button></div> : null}
        {loading ? <div className="state-panel">正在连接研究数据源…</div> : null}
        {!loading && searched && !error && items.length === 0 ? <div className="state-panel">没有找到匹配结果，请调整关键词。</div> : null}
        <div className="research-results">
          {items.map((item) => <article key={item.id}><div className="flex items-center justify-between gap-4"><a href={item.url ?? undefined} target="_blank" rel="noreferrer">{item.title ?? "未命名结果"}</a><small>{item.adapter}</small></div><p>{item.snippet ?? "该来源未提供摘要。"}</p>{item.source_name ? <small>{item.source_name}</small> : null}</article>)}
        </div>
      </section>
    </div>
  );
}
