"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, FileText, MessageSquare, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "@/features/frontend-migration/router";
import { apiMutation, shortDate } from "@/features/workbench/lib/api";
import { ErrorBlock, LoadingBlock, PageHeading, Status, useApiResource } from "@/features/workbench/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Conversation = { id: string; title: string; status: "active" | "archived"; updated_at: string; last_message_preview?: string | null; row_version?: number };
type ConversationDetail = Conversation & { messages: Array<{ id: string; role: string; content: string; created_at: string }> };
type Clarification = { id: string; prompt: string; blocking: boolean; status: string; fields: string[]; answers: Record<string, string> | null; createdAt: string; answeredAt: string | null; expiresAt: string | null };
type Analysis = { analysisId: string; type: string; status: string; createdAt: string; completedAt: string | null; stage?: string; progress?: number; streamUrl?: string; result?: Record<string, unknown> | null; failure?: { code: string; message: string; retryable: boolean } | null };
type AnalysisPack = { analysisId: string; analysis: Analysis; dataFreshness: { marketDataAsOf: string | null; financialReportPeriod: string | null; status: string }; evidence: Array<{ id: string; category: string; stance: string; title: string; summary: string | null; quality: string }>; agentTrace: Array<{ id: string; agent: string; status: string; summary: string | null; purpose: string | null }>; toolCalls: Array<{ id: string; toolName: string; status: string; outputSummary: string | null }>; skillRuns: Array<{ id: string; method: string; status: string; quality: string }>; pandadataProbes: Array<{ id: string; method: string; phase: string; status: string; freshness: string | null }>; conflicts: Array<{ id: string; type: string; summary: string; status: string }>; recommendations: Array<{ id: string; action: string; status: string; summary: string | null; confidence: number | null }>; disclaimer: string };
type Artifact = { id: string; type: "MARKDOWN" | "ECHARTS_OPTION"; title: string; status: string; currentVersion: number; createdAt: string; updatedAt: string };
type ArtifactPreview = { id: string; type: Artifact["type"]; version: number; markdown?: string; option?: Record<string, unknown> };
type ResearchSummary = { id: string; query_text: string; status: string; created_at: string; completed_at: string | null };
type ResearchResult = { id: string; title: string | null; snippet: string | null; url: string | null; adapter: string; source_name?: string | null };
type ResearchSourceStatus = { adapter: string; status: string; result_count: number; error: { message?: string } | null };
type RiskQuestion = { id: string; type: string; prompt: string; options: Array<{ value: string; label: string }> };
type RiskAssessment = { riskLevel: string; score: number; recommendedMaxEquityWeight: number; conflicts: string[] };
type NotificationPreference = { mode: "IMPORTANT_ONLY" | "DAILY_DIGEST" | "MUTED"; quietHoursStart: string | null; quietHoursEnd: string | null; version: number };

function Shell({ title, eyebrow, children, actions }: { title: string; eyebrow: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-semibold">{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground"><p className="font-medium text-foreground">{title}</p><p className="mt-1">{detail}</p></div>;
}

export function ConversationsPage() {
  const navigate = useNavigate();
  const list = useApiResource<{ items: Conversation[] }>("/api/v1/conversations?limit=50");
  const [title, setTitle] = useState("新会话");

  async function createConversation() {
    try {
      const created = await apiMutation<Conversation>("/api/v1/conversations", "POST", { title });
      navigate(`/conversations/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建失败");
    }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="CHAT" title="会话中心" description="会话、追问、输出偏好都从这里进入。" actions={<Button variant="outline" onClick={() => void list.reload()}><RefreshCw className="size-4" />刷新</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.6fr]">
        <Shell title="新建会话" eyebrow="CREATE">
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：长期投资目标梳理" />
            <Button className="w-full" onClick={() => void createConversation()}>创建并进入</Button>
          </div>
        </Shell>
        <Shell title="最近会话" eyebrow="LIST">
          {list.loading ? <LoadingBlock label="正在读取会话…" /> : list.error ? <ErrorBlock message={list.error} retry={list.reload} /> : list.data?.items.length ? (
            <div className="space-y-2">
              {list.data.items.map((item) => (
                <button key={item.id} onClick={() => navigate(`/conversations/${item.id}`)} className="w-full rounded-lg border border-border px-4 py-3 text-left hover:border-primary">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="truncate">{item.title}</strong>
                    <Status tone={item.status === "active" ? "good" : "neutral"}>{item.status.toUpperCase()}</Status>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{item.last_message_preview ?? "暂无消息"}</span>
                    <span>{shortDate(item.updated_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : <Empty title="还没有会话" detail="先创建第一条会话。" />}
        </Shell>
      </div>
    </div>
  );
}

export function ConversationDetailPage({ mode = "detail" as "detail" | "clarifications" | "preference" }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useApiResource<ConversationDetail>(id ? `/api/v1/conversations/${id}` : null);
  const clarifications = useApiResource<{ items: Clarification[] }>(id && mode !== "preference" ? `/api/v1/conversations/${id}/clarifications` : null);
  const preference = useApiResource<{ configuredMode: string | null; effectiveMode: string; version: number }>(id && mode === "preference" ? `/api/v1/conversations/${id}/output-preference` : null);
  const [message, setMessage] = useState("");
  const [outputMode, setOutputMode] = useState<"SQL_ONLY" | "CHART" | "FINANCIAL_REPORT">("SQL_ONLY");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");

  useEffect(() => {
    if (session.data) {
      setEditTitle(session.data.title);
      setEditStatus(session.data.status.toUpperCase() as "ACTIVE" | "ARCHIVED");
    }
  }, [session.data]);

  async function send() {
    if (!id || !message.trim()) return;
    try {
      await apiMutation(`/api/v1/conversations/${id}/messages`, "POST", { content: message.trim(), outputMode });
      setMessage("");
      await session.reload();
      await clarifications.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败");
    }
  }

  async function saveConversation() {
    if (!id || !session.data?.row_version) return;
    try {
      await apiMutation(`/api/v1/conversations/${id}`, "PATCH", { title: editTitle, status: editStatus }, { "If-Match": String(session.data.row_version) });
      await session.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function savePreference() {
    if (!id) return;
    try {
      await apiMutation(`/api/v1/conversations/${id}/output-preference`, "PUT", { outputMode }, preference.data?.version ? { "If-Match": String(preference.data.version) } : undefined);
      await preference.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function answerClarification(item: Clarification) {
    if (!id) return;
    try {
      await apiMutation(`/api/v1/conversations/${id}/clarifications/${item.id}/answer`, "POST", { answers: { answer: answers[item.id] ?? "已补充" } });
      await session.reload();
      await clarifications.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "回答失败");
    }
  }

  if (session.loading) return <LoadingBlock label="正在读取会话…" />;
  if (session.error) return <ErrorBlock message={session.error} retry={session.reload} />;
  if (!session.data) return <Empty title="会话不存在" detail="请从会话中心重新进入。" />;

  return (
    <div className="page-stack">
      <PageHeading eyebrow="CHAT DETAIL" title={session.data.title} description="消息、追问和输出偏好在这里收口。" actions={<Button variant="outline" onClick={() => navigate("/conversations")}><ArrowLeft className="size-4" />返回</Button>} />
      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Shell title="会话消息" eyebrow="MESSAGES">
          {session.data.messages.length ? <div className="space-y-3">{session.data.messages.map((msg) => <div key={msg.id} className={`rounded-lg border px-4 py-3 ${msg.role === "user" ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}><div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>{msg.role}</span><span>{shortDate(msg.created_at)}</span></div><p className="whitespace-pre-wrap text-sm leading-6">{msg.content}</p></div>)}</div> : <Empty title="还没有消息" detail="先发第一条，系统会自动生成分析与证据。" />}
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="输入消息" />
            <div className="flex flex-wrap items-center gap-3">
              <Select value={outputMode} onValueChange={(v) => setOutputMode(v as typeof outputMode)}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="SQL_ONLY">SQL_ONLY</SelectItem><SelectItem value="CHART">CHART</SelectItem><SelectItem value="FINANCIAL_REPORT">FINANCIAL_REPORT</SelectItem></SelectContent>
              </Select>
              <Button onClick={() => void send()}><MessageSquare className="size-4" />发送</Button>
            </div>
          </div>
        </Shell>
        <div className="space-y-6">
          <Shell title="会话配置" eyebrow="CONFIG">
            <div className="space-y-3">
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as "ACTIVE" | "ARCHIVED")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ACTIVE">ACTIVE</SelectItem><SelectItem value="ARCHIVED">ARCHIVED</SelectItem></SelectContent>
              </Select>
              <Button onClick={() => void saveConversation()}>保存会话</Button>
            </div>
          </Shell>
          {mode !== "preference" ? (
            <Shell title="追问" eyebrow="CLARIFICATIONS">
              {clarifications.loading ? <LoadingBlock label="正在读取追问…" /> : clarifications.error ? <ErrorBlock message={clarifications.error} retry={clarifications.reload} /> : clarifications.data?.items.length ? (
                <div className="space-y-3">
                  {clarifications.data.items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-3"><Status tone={item.blocking ? "warn" : "neutral"}>{item.status}</Status><span className="text-xs text-muted-foreground">{shortDate(item.createdAt)}</span></div>
                      <p className="mt-2 text-sm leading-6">{item.prompt}</p>
                      <Input className="mt-3" value={answers[item.id] ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [item.id]: e.target.value }))} placeholder="填写回答" />
                      <Button className="mt-3" size="sm" onClick={() => void answerClarification(item)}>提交回答</Button>
                    </div>
                  ))}
                </div>
              ) : <Empty title="没有追问" detail="Agent 生成后会显示在这里。" />}
            </Shell>
          ) : (
            <Shell title="输出偏好" eyebrow="OUTPUT">
              {preference.loading ? <LoadingBlock label="正在读取偏好…" /> : preference.error ? <ErrorBlock message={preference.error} retry={preference.reload} /> : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">当前配置：{preference.data?.configuredMode ?? "未配置"}，生效模式：{preference.data?.effectiveMode}</p>
                  <Select value={outputMode} onValueChange={(v) => setOutputMode(v as typeof outputMode)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="SQL_ONLY">SQL_ONLY</SelectItem><SelectItem value="CHART">CHART</SelectItem><SelectItem value="FINANCIAL_REPORT">FINANCIAL_REPORT</SelectItem></SelectContent>
                  </Select>
                  <Button onClick={() => void savePreference()}>保存偏好</Button>
                </div>
              )}
            </Shell>
          )}
        </div>
      </div>
    </div>
  );
}

export function AnalysisDetailPage({ mode = "detail" as "detail" | "events" | "evidence" }) {
  const { id } = useParams<{ id: string }>();
  const analysis = useApiResource<Analysis>(id ? `/api/v1/analyses/${id}` : null);
  const pack = useApiResource<AnalysisPack>(id ? `/api/v1/analyses/${id}/evidence-pack` : null);
  const [events, setEvents] = useState<Array<{ id: string; type: string; createdAt: string; payload: Record<string, unknown> }>>([]);

  useEffect(() => {
    if (!id || mode !== "events") return;
    const source = new EventSource(`/api/v1/analyses/${id}/events`);
    source.onmessage = (event) => {
      try { setEvents((current) => [...current.slice(-29), JSON.parse(event.data)]); } catch { /* ignore */ }
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [id, mode]);

  if (analysis.loading) return <LoadingBlock label="正在读取分析…" />;
  if (analysis.error) return <ErrorBlock message={analysis.error} retry={analysis.reload} />;
  if (!analysis.data) return <Empty title="分析不存在" detail="请从会话或建议进入。" />;

  return (
    <div className="page-stack">
      <PageHeading eyebrow="ANALYSIS" title={`${analysis.data.type} · ${analysis.data.status}`} description="分析详情、事件流和证据包都在这里。" actions={<Status tone={analysis.data.status === "COMPLETED" ? "good" : "neutral"}>{analysis.data.stage ?? analysis.data.status}</Status>} />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Shell title="分析摘要" eyebrow="SUMMARY">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">分析 ID</p><p className="mt-1 font-mono text-sm">{analysis.data.analysisId}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">创建时间</p><p className="mt-1 text-sm">{shortDate(analysis.data.createdAt)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">完成时间</p><p className="mt-1 text-sm">{analysis.data.completedAt ? shortDate(analysis.data.completedAt) : "未完成"}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">结果</p><p className="mt-1 text-sm">{analysis.data.result ? JSON.stringify(analysis.data.result) : "—"}</p></div>
          </div>
          {analysis.data.failure ? <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{analysis.data.failure.message}</div> : null}
        </Shell>
        <Shell title={mode === "events" ? "事件流" : "运行状态"} eyebrow="STREAM">
          {mode === "events" ? (
            <div className="space-y-2">
              {events.length ? events.map((event) => <div key={event.id} className="rounded-lg border border-border p-3 text-sm"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{event.type}</span><span>{shortDate(event.createdAt)}</span></div><pre className="mt-2 overflow-auto text-xs">{JSON.stringify(event.payload, null, 2)}</pre></div>) : <Empty title="等待 SSE 事件" detail="若分析正在运行，这里会实时出现。" />}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">事件流地址：<span className="font-mono">{analysis.data.streamUrl}</span></p>
              <p className="text-sm text-muted-foreground">进度：{Math.round((analysis.data.progress ?? 0) * 100)}%</p>
              <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((analysis.data.progress ?? 0) * 100)}%` }} /></div>
            </div>
          )}
        </Shell>
      </div>
      {mode !== "events" ? (
        <Shell title="证据包" eyebrow="EVIDENCE">
          {pack.loading ? <LoadingBlock label="正在读取证据包…" /> : pack.error ? <ErrorBlock message={pack.error} retry={pack.reload} /> : pack.data ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">数据新鲜度</p><p className="mt-1 text-sm">{pack.data.dataFreshness.status}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">证据数</p><p className="mt-1 text-sm">{pack.data.evidence.length}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">冲突数</p><p className="mt-1 text-sm">{pack.data.conflicts.length}</p></div>
              </div>
              {pack.data.evidence.map((item) => <div key={item.id} className="rounded-lg border border-border p-4"><div className="flex items-center justify-between gap-3"><strong>{item.title}</strong><Status tone={item.stance === "COUNTER" ? "warn" : item.stance === "SUPPORT" ? "good" : "neutral"}>{item.stance}</Status></div><p className="mt-2 text-sm text-muted-foreground">{item.summary}</p></div>)}
            </div>
          ) : <Empty title="暂无证据" detail="分析完成后会自动填充。" />}
        </Shell>
      ) : null}
    </div>
  );
}

export function GeneratedArtifactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useApiResource<Artifact>(id ? `/api/v1/generated-artifacts/${id}` : null);
  const preview = useApiResource<ArtifactPreview>(id ? `/api/v1/generated-artifacts/${id}/preview` : null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (detail.data) setTitle(detail.data.title); }, [detail.data]);
  useEffect(() => { if (preview.data) setContent(preview.data.markdown ?? JSON.stringify(preview.data.option ?? {}, null, 2)); }, [preview.data]);
  async function save() {
    if (!id || !detail.data) return;
    try { await apiMutation(`/api/v1/generated-artifacts/${id}`, "PATCH", { title, content, editSummary: "手工修订" }, { "If-Match": String(detail.data.currentVersion) }); setEditing(false); await Promise.all([detail.reload(), preview.reload()]); } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败"); }
  }
  async function remove() {
    if (!id || !detail.data) return;
    if (!confirm("确认删除这个产物？")) return;
    try { await apiMutation(`/api/v1/generated-artifacts/${id}`, "DELETE", undefined, { "If-Match": String(detail.data.currentVersion) }); navigate("/history/artifacts"); } catch (error) { toast.error(error instanceof Error ? error.message : "删除失败"); }
  }
  if (detail.loading) return <LoadingBlock label="正在读取产物…" />;
  if (detail.error) return <ErrorBlock message={detail.error} retry={detail.reload} />;
  if (!detail.data) return <Empty title="产物不存在" detail="请从查询结果重新进入。" />;
  return (
    <div className="page-stack">
      <PageHeading eyebrow="ARTIFACT" title={detail.data.title} description="这里提供预览、修改和删除。" actions={<div className="flex gap-2"><Button variant="outline" onClick={() => setEditing((v) => !v)}><FileText className="size-4" />{editing ? "取消编辑" : "编辑"}</Button><Button variant="outline" onClick={() => void remove()}><Trash2 className="size-4" />删除</Button></div>} />
      <Shell title="安全预览" eyebrow="PREVIEW">{editing ? <div className="space-y-3"><Input value={title} onChange={(e) => setTitle(e.target.value)} /><Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={18} /><Button onClick={() => void save()}><CheckCircle2 className="size-4" />保存为新版本</Button></div> : preview.loading ? <LoadingBlock label="正在生成预览…" /> : preview.error ? <ErrorBlock message={preview.error} retry={preview.reload} /> : preview.data?.markdown ? <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted p-4 text-sm leading-7">{preview.data.markdown}</pre> : preview.data?.option ? <pre className="overflow-auto rounded-lg border border-border bg-muted p-4 text-xs">{JSON.stringify(preview.data.option, null, 2)}</pre> : <Empty title="无预览" detail="产物内容为空或不可预览。" />}</Shell>
    </div>
  );
}

export function ResearchSearchesPage() {
  const list = useApiResource<{ items: ResearchSummary[] }>("/api/v1/research-searches");
  const [query, setQuery] = useState("Money Whisperer 投资组合风险");
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useApiResource<{ items: ResearchResult[]; sourceStatuses: ResearchSourceStatus[] }>(selected ? `/api/v1/research-searches/${selected}/results` : null);

  async function runSearch() {
    try {
      const created = await apiMutation<{ searchId: string }>("/api/v1/research-searches", "POST", { query, adapters: ["KNOWLEDGE_BASE", "MCP", "RSS"], maximumResults: 20 });
      setSelected(created.searchId);
      await Promise.all([list.reload(), detail.reload()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "搜索失败");
    }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="RESEARCH" title="研究搜索" description="信息搜索结果、来源状态和引用都在这里。" actions={<Button variant="outline" onClick={() => void list.reload()}><RefreshCw className="size-4" />刷新</Button>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Shell title="发起搜索" eyebrow="SEARCH">
          <div className="space-y-3"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索公司、主题或市场" /><Button onClick={() => void runSearch()}><Search className="size-4" />开始搜索</Button></div>
        </Shell>
        <Shell title="搜索历史" eyebrow="HISTORY">
          {list.loading ? <LoadingBlock label="正在读取搜索…" /> : list.error ? <ErrorBlock message={list.error} retry={list.reload} /> : list.data?.items.length ? <div className="space-y-2">{list.data.items.map((item) => <button key={item.id} onClick={() => setSelected(item.id)} className="w-full rounded-lg border border-border px-4 py-3 text-left hover:border-primary"><div className="flex items-center justify-between gap-3"><strong className="truncate">{item.query_text}</strong><Status tone={item.status === "completed" ? "good" : "neutral"}>{item.status}</Status></div><div className="mt-1 text-xs text-muted-foreground">{shortDate(item.created_at)}</div></button>)}</div> : <Empty title="还没有搜索" detail="先提交第一条研究搜索。" />}
        </Shell>
      </div>
      <Shell title="搜索结果" eyebrow="RESULTS">
        {detail.loading ? <LoadingBlock label="正在读取结果…" /> : detail.error ? <ErrorBlock message={detail.error} retry={detail.reload} /> : detail.data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">{detail.data.sourceStatuses.map((s) => <Status key={s.adapter} tone={s.status === "ready" ? "good" : s.status === "degraded" ? "warn" : "neutral"}>{s.adapter} · {s.status}</Status>)}</div>
            {detail.data.items.map((item) => <article key={item.id} className="rounded-lg border border-border p-4"><div className="flex items-center justify-between gap-3"><strong>{item.title ?? "未命名结果"}</strong>{item.url ? <a className="text-xs text-primary" href={item.url} target="_blank" rel="noreferrer">打开</a> : null}</div><p className="mt-2 text-sm text-muted-foreground">{item.snippet ?? "无摘要"}</p></article>)}
          </div>
        ) : <Empty title="没有结果" detail="搜索完成后结果会在这里出现。" />}
      </Shell>
    </div>
  );
}

export function ResearchSearchDetailPage() { return <ResearchSearchesPage />; }
export function ResearchSearchResultsPage() { return <ResearchSearchesPage />; }

export function RiskQuestionnairePage() {
  const questions = useApiResource<{ version: number; questions: RiskQuestion[] }>("/api/v1/risk-questionnaire");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RiskAssessment | null>(null);
  async function submit() {
    try {
      const data = await apiMutation<RiskAssessment>("/api/v1/risk-assessments", "POST", { answers });
      setResult(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    }
  }
  return (
    <div className="page-stack">
      <PageHeading eyebrow="RISK" title="风险问卷" description="这里提交问卷并查看当前风险结果。" />
      {questions.loading ? <LoadingBlock label="正在读取问卷…" /> : questions.error ? <ErrorBlock message={questions.error} retry={questions.reload} /> : <Shell title="问卷" eyebrow="QUESTIONNAIRE"><div className="space-y-5">{questions.data?.questions.map((q) => <div key={q.id} className="space-y-2"><p className="text-sm font-medium">{q.prompt}</p><Select value={answers[q.id] ?? ""} onValueChange={(v) => setAnswers((current) => ({ ...current, [q.id]: v }))}><SelectTrigger><SelectValue placeholder="选择答案" /></SelectTrigger><SelectContent>{q.options.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}</SelectContent></Select></div>)}<Button onClick={() => void submit()}><Play className="size-4" />提交评估</Button></div></Shell>}
      {result ? <Shell title="评估结果" eyebrow="RESULT"><div className="grid gap-3 md:grid-cols-3"><div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">风险等级</p><p className="mt-1 text-lg font-semibold">{result.riskLevel}</p></div><div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">得分</p><p className="mt-1 text-lg font-semibold">{result.score}</p></div><div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">权益上限</p><p className="mt-1 text-lg font-semibold">{Math.round(result.recommendedMaxEquityWeight * 100)}%</p></div></div></Shell> : null}
    </div>
  );
}

export function RiskAssessmentsPage() {
  const list = useApiResource<{ items?: Array<{ id: string; risk_level: string; score: number; created_at: string }> }>("/api/v1/risk-assessments?limit=50");
  return <div className="page-stack"><PageHeading eyebrow="RISK HISTORY" title="风险评估历史" description="每一次问卷结果都会保留下来。" />{list.loading ? <LoadingBlock label="正在读取历史…" /> : list.error ? <ErrorBlock message={list.error} retry={list.reload} /> : list.data?.items?.length ? <div className="space-y-2">{list.data.items.map((item) => <div key={item.id} className="rounded-lg border border-border px-4 py-3"><div className="flex items-center justify-between"><strong>{item.risk_level}</strong><span className="text-xs text-muted-foreground">{shortDate(item.created_at)}</span></div><p className="mt-1 text-sm text-muted-foreground">Score {item.score}</p></div>)}</div> : <Empty title="暂无评估" detail="先去风险问卷完成一次评估。" />}</div>;
}

export function NotificationPreferencePage() {
  const pref = useApiResource<NotificationPreference>("/api/v1/notification-preference");
  const [mode, setMode] = useState<NotificationPreference["mode"]>("IMPORTANT_ONLY");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => { if (pref.data) { setMode(pref.data.mode); setStart(pref.data.quietHoursStart ?? ""); setEnd(pref.data.quietHoursEnd ?? ""); } }, [pref.data]);
  async function save() {
    try {
      await apiMutation("/api/v1/notification-preference", "PUT", { mode, quietHoursStart: start || null, quietHoursEnd: end || null }, pref.data?.version ? { "If-Match": String(pref.data.version) } : undefined);
      await pref.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  }
  return <div className="page-stack"><PageHeading eyebrow="NOTIFICATIONS" title="通知偏好" description="设置提醒频率和静默时段。" />{pref.loading ? <LoadingBlock label="正在读取偏好…" /> : pref.error ? <ErrorBlock message={pref.error} retry={pref.reload} /> : <Shell title="偏好设置" eyebrow="PREFERENCE"><div className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label>模式</Label><Select value={mode} onValueChange={(v) => setMode(v as NotificationPreference["mode"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IMPORTANT_ONLY">IMPORTANT_ONLY</SelectItem><SelectItem value="DAILY_DIGEST">DAILY_DIGEST</SelectItem><SelectItem value="MUTED">MUTED</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>静默开始</Label><Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="22:00" /></div><div className="space-y-2"><Label>静默结束</Label><Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="07:00" /></div></div><Button className="mt-4" onClick={() => void save()}>保存偏好</Button></Shell>}</div>;
}

export function DemoBootstrapPage() {
  const [results, setResults] = useState<Array<{ path: string; ok: boolean; message: string }>>([]);
  async function probe() {
    const endpoints = ["/api/v1/demo/bootstrap", "/api/v1/demo/reset"];
    const next: Array<{ path: string; ok: boolean; message: string }> = [];
    for (const path of endpoints) {
      try { await apiMutation(path, "POST", {}); next.push({ path, ok: true, message: "可用" }); }
      catch (error) { next.push({ path, ok: false, message: error instanceof Error ? error.message : "不可用" }); }
    }
    setResults(next);
  }
  return <div className="page-stack"><PageHeading eyebrow="DEMO" title="Demo Seed / Reset" description="这里预留演示环境的启动与重置入口。" /><Shell title="入口检查" eyebrow="PROBE" actions={<Button variant="outline" onClick={() => void probe()}>检测接口</Button>}>{results.length ? <div className="space-y-3">{results.map((item) => <div key={item.path} className="flex items-center justify-between rounded-lg border border-border px-4 py-3"><div><p className="font-medium">{item.path}</p><p className="text-xs text-muted-foreground">{item.message}</p></div><Status tone={item.ok ? "good" : "danger"}>{item.ok ? "可用" : "不可用"}</Status></div>)}</div> : <Empty title="尚未检测" detail="点击按钮后会检查 bootstrap/reset 入口。" />}</Shell></div>;
}

export function DemoResetPage() { return <DemoBootstrapPage />; }
