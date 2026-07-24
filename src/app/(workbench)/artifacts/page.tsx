"use client";

import { BarChart3, FilePenLine, FileText, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, Status, useApiResource } from "@/features/workbench/components/shared";
import { apiGet, apiMutation, shortDate } from "@/features/workbench/lib/api";

type Artifact = { id: string; type: "MARKDOWN" | "ECHARTS_OPTION"; title: string; status: string; currentVersion: number; previewUrl: string; createdAt: string; updatedAt: string };
type Preview = { id: string; type: Artifact["type"]; version: number; markdown?: string; option?: { title?: { text?: string }; xAxis?: { data?: string[] }; series?: Array<{ name?: string; data?: number[] }> } };

export default function ArtifactsPage() {
  const list = useApiResource<{ items: Artifact[] }>("/api/v1/generated-artifacts?limit=50");
  const [selected, setSelected] = useState(""); const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState(false); const [content, setContent] = useState(""); const [title, setTitle] = useState(""); const [error, setError] = useState("");
  const current = list.data?.items.find((item) => item.id === selected) ?? null;
  useEffect(() => { if (!selected && list.data?.items[0]) { const fromUrl = new URLSearchParams(window.location.search).get("selected"); setSelected(fromUrl && list.data.items.some((item) => item.id === fromUrl) ? fromUrl : list.data.items[0].id); } }, [list.data, selected]);
  useEffect(() => { if (!selected) return; setError(""); void apiGet<Preview>(`/api/v1/generated-artifacts/${selected}/preview`).then((data) => { setPreview(data); setContent(data.markdown ?? JSON.stringify(data.option ?? {}, null, 2)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "预览失败")); }, [selected]);
  useEffect(() => { if (current) setTitle(current.title); }, [current]);
  const save = async () => {
    if (!current) return; setError("");
    try { await apiMutation(`/api/v1/generated-artifacts/${current.id}`, "PATCH", { title, content, editSummary: "在报告中心手工修订" }, { "If-Match": String(current.currentVersion) }); setEditing(false); await list.reload(); setPreview(await apiGet<Preview>(`/api/v1/generated-artifacts/${current.id}/preview`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  };
  const remove = async () => {
    if (!current || !window.confirm(`确认删除“${current.title}”？`)) return;
    try { await apiMutation(`/api/v1/generated-artifacts/${current.id}`, "DELETE", undefined, { "If-Match": String(current.currentVersion) }); setSelected(""); setPreview(null); await list.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
  };
  if (list.loading) return <LoadingBlock label="正在整理图表与报告" />;
  return <div className="page-stack artifact-page">
    <PageHeading eyebrow="ARTIFACT LIBRARY / 研究产物" title="报告中心" description="查数结果生成的图表与 Markdown 报告集中保存，支持安全预览、版本化修改和软删除。" />
    {error ? <ErrorBlock message={error} /> : null}
    <section className="artifact-layout">
      <aside className="panel artifact-list"><div className="panel-heading"><div><span>LIBRARY</span><h2>全部产物</h2></div><Status>{list.data?.items.length ?? 0}</Status></div>{list.data?.items.length ? list.data.items.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => { setSelected(item.id); setEditing(false); }}><span className="artifact-icon">{item.type === "MARKDOWN" ? <FileText size={18} /> : <BarChart3 size={18} />}</span><span><b>{item.title}</b><small>{item.type === "MARKDOWN" ? "财务报告" : "数据图表"} · v{item.currentVersion}</small><em>{shortDate(item.updatedAt)}</em></span></button>) : <EmptyBlock title="还没有产物" detail="先到智能查数选择图表或财务报告输出。" />}</aside>
      <article className="panel artifact-preview"><div className="panel-heading"><div><span>SAFE PREVIEW</span><h2>{current?.title ?? "选择一个产物"}</h2></div>{current ? <div className="artifact-actions"><button className="button ghost" onClick={() => setEditing((value) => !value)}><FilePenLine size={14} />{editing ? "取消" : "修改"}</button><button className="icon-button danger" onClick={() => void remove()} aria-label="删除"><Trash2 size={15} /></button></div> : null}</div>{!current ? <EmptyBlock title="等待选择" detail="从左侧选择图表或报告查看内容。" /> : editing ? <div className="artifact-editor"><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={22} /></label><button className="button primary" onClick={() => void save()}><Save size={15} />保存为新版本</button></div> : preview?.type === "MARKDOWN" ? <MarkdownPreview markdown={preview.markdown ?? ""} /> : preview?.option ? <ChartPreview option={preview.option} /> : <LoadingBlock label="正在生成安全预览" />}</article>
    </section>
  </div>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return <div className="markdown-preview">{markdown.split("\n").map((line, index) => line.startsWith("# ") ? <h1 key={index}>{line.slice(2)}</h1> : line.startsWith("## ") ? <h2 key={index}>{line.slice(3)}</h2> : line.startsWith("| ") ? <code key={index}>{line}</code> : line ? <p key={index}>{line}</p> : <br key={index} />)}</div>;
}

function ChartPreview({ option }: { option: NonNullable<Preview["option"]> }) {
  const labels = option.xAxis?.data ?? []; const series = option.series ?? []; const all = series.flatMap((item) => item.data ?? []); const max = Math.max(...all.map(Math.abs), 1);
  return <div className="chart-preview"><h3>{option.title?.text ?? "数据图表"}</h3><div className="chart-legend">{series.map((item, index) => <span key={item.name}><i data-color={index % 3} />{item.name}</span>)}</div><div className="chart-bars">{labels.map((label, row) => <div key={`${label}-${row}`}><span>{label || `#${row + 1}`}</span><div>{series.map((item, index) => <i key={item.name} data-color={index % 3} style={{ width: `${Math.abs(Number(item.data?.[row] ?? 0)) / max * 100}%` }} title={`${item.name}: ${item.data?.[row] ?? 0}`} />)}</div></div>)}</div></div>;
}
