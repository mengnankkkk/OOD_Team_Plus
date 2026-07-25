"use client";

import { BarChart3, FilePenLine, FileText, MessageSquareText, Save, ShieldCheck, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, Status, useApiResource } from "@/features/workbench/components/shared";
import { apiGet, apiMutation, shortDate } from "@/features/workbench/lib/api";
import { useNavigate } from "@/features/frontend-migration/router";

type Artifact = { id: string; type: "MARKDOWN" | "ECHARTS_OPTION"; title: string; status: string; currentVersion: number; previewUrl: string; conversationId?: string | null; recommendationId?: string | null; createdAt: string; updatedAt: string };
type Preview = { id: string; type: Artifact["type"]; version: number; markdown?: string; option?: { title?: { text?: string }; xAxis?: { data?: string[] }; series?: Array<{ name?: string; data?: number[] }> } };

export function ArtifactLibrary({
  embedded = false,
  headerActions,
  refreshToken = 0,
  autoSelectArtifactId,
}: {
  embedded?: boolean;
  headerActions?: ReactNode;
  refreshToken?: number;
  autoSelectArtifactId?: string | null;
}) {
  const navigate = useNavigate();
  const list = useApiResource<{ items: Artifact[] }>("/api/v1/generated-artifacts?limit=50");
  const reloadList = list.reload;
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const current = list.data?.items.find((item) => item.id === selected) ?? null;

  useEffect(() => {
    if (refreshToken > 0) void reloadList();
  }, [refreshToken, reloadList]);

  useEffect(() => {
    const items = list.data?.items ?? [];
    if (!items.length) return;
    const fromUrl = new URLSearchParams(window.location.search).get("selected");
    const next = autoSelectArtifactId && items.some((item) => item.id === autoSelectArtifactId)
      ? autoSelectArtifactId
      : fromUrl && items.some((item) => item.id === fromUrl)
        ? fromUrl
        : selected && items.some((item) => item.id === selected) ? selected : items[0].id;
    if (next !== selected) {
      setSelected(next);
      setEditing(false);
    }
  }, [autoSelectArtifactId, list.data, selected]);

  useEffect(() => {
    if (!selected) return;
    setError("");
    setPreview(null);
    void apiGet<Preview>(`/api/v1/generated-artifacts/${selected}/preview`)
      .then((data) => {
        setPreview(data);
        setContent(data.markdown ?? JSON.stringify(data.option ?? {}, null, 2));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "预览失败"));
  }, [selected]);

  useEffect(() => {
    if (current) setTitle(current.title);
  }, [current]);

  const save = async () => {
    if (!current) return;
    setError("");
    try {
      await apiMutation(`/api/v1/generated-artifacts/${current.id}`, "PATCH", { title, content, editSummary: "在报告产物中手工修订" }, { "If-Match": String(current.currentVersion) });
      setEditing(false);
      await list.reload();
      setPreview(await apiGet<Preview>(`/api/v1/generated-artifacts/${current.id}/preview`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    }
  };

  const remove = async () => {
    if (!current || !window.confirm(`确认删除“${current.title}”？`)) return;
    try {
      await apiMutation(`/api/v1/generated-artifacts/${current.id}`, "DELETE", undefined, { "If-Match": String(current.currentVersion) });
      setSelected("");
      setPreview(null);
      await list.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  };

  if (list.loading) return <LoadingBlock label="正在整理图表与报告" />;

  return (
    <div className={embedded ? "mt-6 artifact-page" : "page-stack artifact-page"}>
      {embedded ? (
        <header className="mb-5 flex flex-col gap-4 border-b-4 border-foreground pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="section-kicker">报告库 / 研究产物</span>
            <h2 className="mt-2 text-2xl font-semibold">报告产物</h2>
            <p className="mt-2 text-sm text-muted-foreground">资产智能顾问与查数结果生成的图表、报告集中保存在这里。</p>
          </div>
          {headerActions ? <div className="flex shrink-0 flex-wrap gap-2">{headerActions}</div> : null}
        </header>
      ) : (
        <PageHeading eyebrow="报告库 / 研究产物" title="报告产物" description="资产智能顾问与查数结果生成的图表、报告集中保存在这里。" actions={headerActions} />
      )}
      {error ? <ErrorBlock message={error} /> : null}
      <section className="artifact-layout">
        <aside className="panel artifact-list">
          <div className="panel-heading"><div><span>报告列表</span><h2>全部产物</h2></div><Status>{list.data?.items.length ?? 0}</Status></div>
          {list.data?.items.length ? list.data.items.map((item) => (
            <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => { setSelected(item.id); setEditing(false); }}>
              <span className="artifact-icon">{item.type === "MARKDOWN" ? <FileText size={18} /> : <BarChart3 size={18} />}</span>
              <span><b>{item.title}</b><small>{item.type === "MARKDOWN" ? "财务报告" : "数据图表"} · v{item.currentVersion}</small><em>{shortDate(item.updatedAt)}</em></span>
            </button>
          )) : <EmptyBlock title="还没有产物" detail="暂无报告或图表产物。" />}
        </aside>
        <article className="panel artifact-preview">
          <div className="panel-heading">
            <div><span>安全预览</span><h2>{current?.title ?? "选择一个产物"}</h2></div>
            {current ? <div className="artifact-actions">{current.recommendationId ? <button className="button ghost" onClick={() => navigate(`/recommendations/${encodeURIComponent(current.recommendationId!)}`)}><ShieldCheck size={14} />查看建议卡</button> : null}{current.conversationId ? <button className="button ghost" onClick={() => navigate(`/advisor?conversationId=${encodeURIComponent(current.conversationId!)}`)}><MessageSquareText size={14} />对应对话</button> : null}<button className="button ghost" onClick={() => setEditing((value) => !value)}><FilePenLine size={14} />{editing ? "取消" : "修改"}</button><button className="icon-button danger" onClick={() => void remove()} aria-label="删除"><Trash2 size={15} /></button></div> : null}
          </div>
          {!current ? <EmptyBlock title="等待选择" detail="从左侧选择图表或报告查看内容。" /> : editing ? (
            <div className="artifact-editor">
              <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={22} /></label>
              <button className="button primary" onClick={() => void save()}><Save size={15} />保存为新版本</button>
            </div>
          ) : preview?.type === "MARKDOWN" ? <MarkdownPreview markdown={preview.markdown ?? ""} /> : preview?.option ? <ChartPreview option={preview.option} /> : <LoadingBlock label="正在生成安全预览" />}
        </article>
      </section>
    </div>
  );
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("| ") && lines[index + 1]?.startsWith("| ---")) {
      const tableLines: string[] = [];
      while (lines[index]?.startsWith("| ")) tableLines.push(lines[index++] ?? "");
      blocks.push(<MarkdownTable key={`table-${index}`} lines={tableLines} />);
      continue;
    }
    if (line.startsWith("# ")) blocks.push(<h1 key={index}>{line.slice(2)}</h1>);
    else if (line.startsWith("## ")) blocks.push(<h2 key={index}>{line.slice(3)}</h2>);
    else if (line.startsWith("### ")) blocks.push(<h3 key={index}>{line.slice(4)}</h3>);
    else if (line.startsWith("- ")) blocks.push(<p className="markdown-bullet" key={index}><span>•</span>{line.slice(2)}</p>);
    else if (line.startsWith("**") && line.endsWith("**")) blocks.push(<p className="markdown-callout" key={index}>{line.slice(2, -2)}</p>);
    else if (line) blocks.push(<p key={index}>{renderInlineMarkdown(line)}</p>);
    else if (blocks.length && lines[index - 1]) blocks.push(<div className="markdown-spacer" key={index} />);
    index += 1;
  }
  return <div className="markdown-preview">{blocks}</div>;
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const headers = cells(lines[0] ?? "");
  return (
    <div className="markdown-table-wrap">
      <table className="markdown-table">
        <thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead>
        <tbody>{lines.slice(2).map((line, rowIndex) => <tr key={rowIndex}>{cells(line).map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function renderInlineMarkdown(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/u);
  return parts.map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part);
}

function ChartPreview({ option }: { option: NonNullable<Preview["option"]> }) {
  const labels = option.xAxis?.data ?? [];
  const series = option.series ?? [];
  const all = series.flatMap((item) => item.data ?? []);
  const max = Math.max(...all.map(Math.abs), 1);
  return (
    <div className="chart-preview">
      <h3>{option.title?.text ?? "数据图表"}</h3>
      <div className="chart-legend">{series.map((item, index) => <span key={item.name}><i data-color={index % 3} />{item.name}</span>)}</div>
      <div className="chart-bars">{labels.map((label, row) => <div key={`${label}-${row}`}><span>{label || `#${row + 1}`}</span><div>{series.map((item, index) => <i key={item.name} data-color={index % 3} style={{ width: `${Math.abs(Number(item.data?.[row] ?? 0)) / max * 100}%` }} title={`${item.name}: ${item.data?.[row] ?? 0}`} />)}</div></div>)}</div>
    </div>
  );
}
