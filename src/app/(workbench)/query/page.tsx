"use client";

import { Braces, Check, FileText, Play, ShieldCheck, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { ErrorBlock, PageHeading, Status, useApiResource } from "@/features/workbench/components/shared";
import { apiGet, apiMutation, shortDate } from "@/features/workbench/lib/api";

const DATASETS = [
  { key: "PORTFOLIO_HOLDINGS", label: "持仓快照" }, { key: "PORTFOLIO_SNAPSHOTS", label: "组合快照" },
  { key: "PORTFOLIO_METRICS", label: "健康指标" }, { key: "INSTRUMENTS", label: "标的目录" },
];
const EXAMPLES = ["按行业汇总我的持仓市值和浮盈亏", "查看 AAPL 的持仓明细", "展示最近的组合健康度和风险度", "列出可交易的证券标的"];
type QueryDetail = { id: string; question: string; status: string; plan: { datasets: string[]; dimensions: string[]; metrics: string[] }; sql: { statement: string; safetyChecks: string[] }; result: { rowCount: number; truncated: boolean }; sources: Array<{ planner?: string }> };
type QueryResult = { columns: Array<{ name: string; type: string }>; items: Array<{ rowId: string; values: Record<string, unknown> }>; rowCount: number; truncated: boolean };
type QuerySummary = { id: string; question: string; status: string; rowCount: number; outputMode: string; createdAt: string };

export default function QueryPage() {
  const [question, setQuestion] = useState(EXAMPLES[0]); const [datasets, setDatasets] = useState(["PORTFOLIO_HOLDINGS"]);
  const [mode, setMode] = useState<"SQL_ONLY" | "CHART" | "FINANCIAL_REPORT">("CHART");
  const [running, setRunning] = useState(false); const [error, setError] = useState("");
  const [detail, setDetail] = useState<QueryDetail | null>(null); const [result, setResult] = useState<QueryResult | null>(null); const [artifactId, setArtifactId] = useState("");
  const history = useApiResource<{ items: QuerySummary[] }>("/api/v1/data-queries?limit=8");
  const toggleDataset = (key: string) => setDatasets((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const run = async (event: FormEvent) => {
    event.preventDefault(); if (!question.trim() || !datasets.length) return; setRunning(true); setError(""); setArtifactId("");
    try {
      const created = await apiMutation<{ resourceId: string }>("/api/v1/data-queries", "POST", { questionText: question.trim(), requestedDatasets: datasets, outputMode: mode, requestedLimit: 200 });
      const [nextDetail, nextResult] = await Promise.all([apiGet<QueryDetail>(`/api/v1/data-queries/${created.resourceId}`), apiGet<QueryResult>(`/api/v1/data-queries/${created.resourceId}/result?limit=200`)]);
      setDetail(nextDetail); setResult(nextResult);
      if (mode !== "SQL_ONLY") {
        const artifact = await apiMutation<{ resourceId: string }>("/api/v1/generated-artifacts", "POST", { artifactType: mode === "CHART" ? "ECHARTS_OPTION" : "MARKDOWN", title: question.slice(0, 70), sourceQueryId: created.resourceId });
        setArtifactId(artifact.resourceId);
      }
      void history.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "查询失败"); } finally { setRunning(false); }
  };
  return <div className="page-stack query-page">
    <PageHeading eyebrow="SEMANTIC QUERY DESK / 语义查数台" title="把问题变成安全、可解释的 SQL" description="语义规则先生成 QueryPlan，再经过数据集白名单、参数化、SQL AST 与 SQLite authorizer 四层校验。" />
    <section className="query-layout">
      <form className="panel query-composer" onSubmit={(event) => void run(event)}>
        <div className="panel-heading"><div><span>ASK THE LEDGER</span><h2>你想从数据里知道什么？</h2></div><Status tone="good"><ShieldCheck size={12} /> READ ONLY</Status></div>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} aria-label="查数问题" />
        <div className="example-row">{EXAMPLES.map((example) => <button type="button" key={example} onClick={() => setQuestion(example)}>{example}</button>)}</div>
        <fieldset><legend>选择可访问的数据集</legend><div className="dataset-grid">{DATASETS.map((item) => <label key={item.key} className={datasets.includes(item.key) ? "selected" : ""}><input type="checkbox" checked={datasets.includes(item.key)} onChange={() => toggleDataset(item.key)} /><span>{datasets.includes(item.key) ? <Check size={14} /> : null}</span><b>{item.label}</b><small>{item.key}</small></label>)}</div></fieldset>
        <div className="mode-row"><span>输出方式</span>{(["SQL_ONLY", "CHART", "FINANCIAL_REPORT"] as const).map((item) => <button type="button" key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item === "SQL_ONLY" ? <Braces size={15} /> : item === "CHART" ? <Sparkles size={15} /> : <FileText size={15} />}{item === "SQL_ONLY" ? "数据表" : item === "CHART" ? "图表" : "财务报告"}</button>)}<button className="button primary run-query" disabled={running || !datasets.length}>{running ? "正在规划…" : <><Play size={15} />执行查询</>}</button></div>
        {error ? <ErrorBlock message={error} /> : null}
      </form>
      <aside className="panel query-history"><div className="panel-heading"><div><span>RECENT RUNS</span><h2>查询记录</h2></div></div>{history.data?.items.length ? <div className="history-list">{history.data.items.map((item) => <button key={item.id} onClick={async () => { setError(""); try { setDetail(await apiGet<QueryDetail>(`/api/v1/data-queries/${item.id}`)); setResult(await apiGet<QueryResult>(`/api/v1/data-queries/${item.id}/result?limit=200`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "读取失败"); } }}><Status tone={item.status === "SUCCEEDED" ? "good" : item.status === "FAILED" ? "danger" : "neutral"}>{item.status}</Status><b>{item.question}</b><small>{item.rowCount} 行 · {shortDate(item.createdAt)}</small></button>)}</div> : <p className="muted-copy">执行第一条查询后，计划和结果会保留在这里。</p>}</aside>
    </section>
    {detail && result ? <section className="panel query-result"><div className="panel-heading"><div><span>QUERY RESULT</span><h2>{detail.question}</h2></div><div className="result-badges"><Status tone="good">{result.rowCount} ROWS</Status>{artifactId ? <a className="button ghost" href={`/artifacts?selected=${artifactId}`}>查看生成产物</a> : null}</div></div><div className="plan-ribbon"><span><b>Planner</b>{detail.sources[0]?.planner ?? "SEMANTIC_RULES"}</span><span><b>Dataset</b>{detail.plan.datasets.join(", ")}</span><span><b>Safety</b>{detail.sql.safetyChecks.length} checks</span></div><details className="sql-panel"><summary>查看已脱敏 SQL 与 QueryPlan</summary><pre>{detail.sql.statement}</pre><div>{detail.sql.safetyChecks.map((item) => <Status key={item} tone="good">{item}</Status>)}</div></details><div className="table-scroll"><table className="data-table"><thead><tr>{result.columns.map((column) => <th key={column.name}>{column.name}<small>{column.type}</small></th>)}</tr></thead><tbody>{result.items.map((row) => <tr key={row.rowId}>{result.columns.map((column) => <td key={column.name}>{String(row.values[column.name] ?? "—")}</td>)}</tr>)}</tbody></table></div></section> : null}
  </div>;
}
