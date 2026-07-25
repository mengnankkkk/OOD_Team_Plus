import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileSearch,
  History,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "@/features/frontend-migration/router";
import { useDecisionLogs } from "@/hooks/useAlerts";
import { cn } from "@/lib/utils";
import type { DecisionAction, DecisionLog } from "@/types/app/notice";

type ActionFilter = "all" | "simulated" | "rejected" | "revoked" | "followup_question" | "later";

const ACTION_META: Record<DecisionAction, { label: string; summary: string; color: string; surface: string; icon: LucideIcon }> = {
  viewed: { label: "已查看", summary: "打开并审阅了建议", color: "text-muted-foreground", surface: "bg-muted", icon: History },
  followup_question: { label: "继续追问", summary: "围绕原建议补充了问题", color: "text-primary", surface: "bg-primary/10", icon: MessageSquareText },
  simulated: { label: "模拟采纳", summary: "将建议纳入组合情景模拟", color: "text-[hsl(var(--status-down))]", surface: "bg-[hsl(var(--status-down))]/10", icon: CheckCircle2 },
  revoked: { label: "已撤销", summary: "撤回此前的模拟采纳", color: "text-[hsl(var(--status-watch))]", surface: "bg-[hsl(var(--status-watch))]/10", icon: RotateCcw },
  rejected: { label: "已拒绝", summary: "决定不采用这条建议", color: "text-destructive", surface: "bg-destructive/10", icon: XCircle },
  later: { label: "稍后处理", summary: "暂不执行，保留观察", color: "text-muted-foreground", surface: "bg-muted", icon: Clock3 },
  commented: { label: "补充备注", summary: "为该建议添加了说明", color: "text-primary", surface: "bg-primary/10", icon: MessageSquareText },
};

const FILTERS: Array<{ value: ActionFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "simulated", label: "模拟采纳" },
  { value: "rejected", label: "拒绝" },
  { value: "revoked", label: "撤销" },
  { value: "followup_question", label: "追问" },
  { value: "later", label: "稍后" },
];

const STATUS_LABEL: Record<string, string> = {
  active: "待决策",
  degraded: "证据不足",
  blocked: "合规拦截",
  simulated: "模拟采纳中",
  rejected: "已拒绝",
  expired: "已过期",
};

const DecisionLogPage = () => {
  const { data: logs = [], isLoading, isFetching, error, refetch } = useDecisionLogs(100);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ActionFilter>("all");
  const [keyword, setKeyword] = useState("");

  const filteredLogs = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return logs.filter((log) => {
      if (filter !== "all" && log.action !== filter) return false;
      if (!query) return true;
      const snapshot = log.agentSnapshot;
      return [
        log.instrument?.symbol,
        log.instrument?.name,
        log.conversationTitle,
        log.userQuestion,
        log.advisorReply,
        log.reason,
        log.note,
        snapshot.summary,
        snapshot.action,
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
    });
  }, [filter, keyword, logs]);

  const stats = useMemo(() => ({
    total: logs.length,
    accepted: logs.filter((log) => log.action === "simulated").length,
    followups: logs.filter((log) => log.action === "followup_question").length,
    open: new Set(logs.filter((log) => ["active", "simulated", "degraded"].includes(log.currentStatus ?? "")).map((log) => log.recommendationId)).size,
  }), [logs]);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">决策档案 · Decision ledger</p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">决策日志</h1>
          <p className="mt-2 text-sm text-muted-foreground">复盘每次建议、选择与后续追问。</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="刷新决策日志"
          aria-label="刷新决策日志"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
        </Button>
      </header>

      <section aria-label="决策统计" className="grid border-b border-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="记录总数" value={stats.total} />
        <Metric label="模拟采纳" value={stats.accepted} tone="positive" />
        <Metric label="后续追问" value={stats.followups} tone="primary" />
        <Metric label="仍在跟踪" value={stats.open} tone="warning" />
      </section>

      <div className="flex flex-col gap-4 py-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="h-10 pl-9"
            placeholder="搜索标的、问题或理由"
            aria-label="搜索决策日志"
          />
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto border border-border bg-muted/30 p-1" role="group" aria-label="按动作筛选">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                "h-8 shrink-0 px-3 text-xs font-medium transition-colors",
                filter === item.value ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <DecisionLogSkeleton />
      ) : error ? (
        <EmptyState icon={ShieldAlert} title="决策日志读取失败" detail={error instanceof Error ? error.message : "请稍后重试"} />
      ) : logs.length === 0 ? (
        <EmptyState icon={Clock3} title="还没有决策记录" detail="在顾问建议卡中模拟采纳、拒绝或继续追问后，记录会出现在这里。" />
      ) : filteredLogs.length === 0 ? (
        <EmptyState icon={Search} title="没有匹配的记录" detail="换一个关键词或筛选条件。" />
      ) : (
        <ol className="relative space-y-4 pb-10 before:absolute before:bottom-8 before:left-5 before:top-7 before:w-px before:bg-border md:before:left-6">
          {filteredLogs.map((log) => (
            <DecisionEntry key={log.id} log={log} onNavigate={navigate} />
          ))}
        </ol>
      )}
    </div>
  );
};

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "positive" | "primary" | "warning" }) {
  return (
    <div className="border-border px-1 py-5 sm:even:border-l lg:border-l lg:first:border-l-0 lg:px-6">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-1 font-mono text-2xl font-semibold",
        tone === "positive" && "text-[hsl(var(--status-down))]",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-[hsl(var(--status-watch))]",
      )}>{value}</p>
    </div>
  );
}

function DecisionEntry({ log, onNavigate }: { log: DecisionLog; onNavigate: (to: string) => void }) {
  const meta = ACTION_META[log.action];
  const Icon = meta.icon;
  const snapshot = log.agentSnapshot;
  const summary = text(snapshot.summary) ?? log.conversationTitle ?? "顾问建议";
  const reasons = stringList(snapshot.reasons);
  const counterEvidence = stringList(snapshot.counterEvidence);
  const risks = stringList(snapshot.risks);
  const positionRange = percentRange(snapshot.positionRange);
  const status = log.currentStatus ? STATUS_LABEL[log.currentStatus] ?? log.currentStatus : "历史快照";
  const continuePrompt = `关于此前建议“${summary}”，我想继续确认：`;

  return (
    <li className="relative pl-12 md:pl-16">
      <span className={cn("absolute left-0 top-5 z-10 grid size-10 place-items-center border-4 border-background md:left-1 md:size-11", meta.surface, meta.color)}>
        <Icon className="size-4" />
      </span>
      <article className="paper-card overflow-hidden p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("font-semibold", meta.color)}>{meta.label}</span>
              <span className="text-muted-foreground">{meta.summary}</span>
              <span className="border-l border-border pl-2 font-mono text-[10px] text-muted-foreground">{absoluteTime(log.createdAt)}</span>
            </div>
            <h2 className="mt-3 break-words text-lg font-semibold leading-snug md:text-xl">{summary}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {log.instrument ? <span className="font-mono text-foreground">{log.instrument.symbol} · {log.instrument.name}</span> : null}
              {text(snapshot.horizon) ? <span>期限 {text(snapshot.horizon)}</span> : null}
              {text(snapshot.dataAsOf) ? <span>数据截至 {shortDate(snapshot.dataAsOf)}</span> : null}
            </div>
          </div>
          <span className="w-fit shrink-0 border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-muted-foreground">当前 · {status}</span>
        </div>

        {log.userQuestion ? (
          <div className="mt-5 border-l-2 border-primary/35 pl-4">
            <p className="eyebrow">当时的问题</p>
            <p className="mt-1 line-clamp-2 break-words text-sm leading-6">{log.userQuestion}</p>
          </div>
        ) : null}

        {(log.reason || log.note) ? (
          <div className="mt-4 bg-muted/45 px-4 py-3 text-sm">
            <span className="mr-2 text-xs font-medium text-muted-foreground">决策说明</span>
            <span className="break-words">{log.reason ?? log.note}</span>
          </div>
        ) : null}

        <details className="group mt-5 border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            展开完整记录
          </summary>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,.75fr)]">
            <div className="min-w-0 space-y-5">
              {log.advisorReply ? (
                <section>
                  <p className="eyebrow">顾问原始答复</p>
                  <p className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words pr-2 text-sm leading-6 text-muted-foreground">{log.advisorReply}</p>
                </section>
              ) : null}
              {reasons.length ? <EvidenceList title="支持依据" items={reasons.slice(0, 3)} /> : null}
              {counterEvidence.length ? <EvidenceList title="反方证据" items={counterEvidence.slice(0, 2)} warning /> : null}
            </div>

            <dl className="grid content-start grid-cols-2 gap-x-4 gap-y-4 border-l-0 border-border text-sm lg:border-l lg:pl-5">
              <Fact label="建议动作" value={actionLabel(snapshot.action)} />
              <Fact label="适合程度" value={text(snapshot.suitability) ?? "未标注"} />
              <Fact label="建议仓位" value={positionRange ?? "未量化"} />
              <Fact label="首笔仓位" value={text(snapshot.firstPosition) ?? "未量化"} />
              <Fact label="止损条件" value={text(snapshot.stopLoss) ?? "随逻辑失效"} />
              <Fact label="止盈条件" value={text(snapshot.takeProfit) ?? "按组合再平衡"} />
              <Fact label="有效期至" value={shortDate(snapshot.expiresAt)} />
              <Fact label="失效条件" value={text(snapshot.invalidation) ?? "数据或逻辑变化"} />
              {risks.length ? <div className="col-span-2"><Fact label="主要风险" value={risks.slice(0, 3).join("；")} /></div> : null}
            </dl>
          </div>
        </details>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {log.analysisId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onNavigate(`/history/evidence-lab?analysisId=${encodeURIComponent(log.analysisId!)}`)}>
              查看证据 <FileSearch className="size-3.5" />
            </Button>
          ) : null}
          {log.recommendationId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onNavigate(`/recommendations/${log.recommendationId}`)}>
              回到当时的建议 <ArrowUpRight className="size-3.5" />
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate(`/advisor?prompt=${encodeURIComponent(continuePrompt)}`)}>
            继续追问 <MessageSquareText className="size-3.5" />
          </Button>
          <span className="ml-auto font-mono text-[9px] text-muted-foreground">ID {log.id.slice(-10).toUpperCase()}</span>
        </div>
      </article>
    </li>
  );
}

function EvidenceList({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
  return (
    <section>
      <p className={cn("eyebrow", warning && "text-[hsl(var(--status-watch))]")}>{title}</p>
      <ul className="mt-2 divide-y divide-border border-y border-border text-sm">
        {items.map((item, index) => <li key={`${item}-${index}`} className="break-words py-2.5 leading-5 text-muted-foreground">{item}</li>)}
      </ul>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="mt-1 break-words leading-5">{value}</dd></div>;
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="grid min-h-64 place-items-center border-y border-border text-center">
      <div className="max-w-md px-6 py-10">
        <Icon className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 font-medium">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function DecisionLogSkeleton() {
  return (
    <div className="space-y-4 pb-10">
      {[0, 1, 2].map((item) => <div key={item} className="ml-12 h-44 animate-pulse border border-border bg-muted/40 md:ml-16" />)}
    </div>
  );
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : [];
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const candidate = text(row.summary) ?? text(row.value) ?? text(row.statement) ?? text(row.label);
    return candidate ? [candidate] : [];
  });
}

function percentRange(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const numbers = value.slice(0, 2).map(Number);
  if (numbers.some((item) => !Number.isFinite(item))) return null;
  const scale = numbers.every((item) => Math.abs(item) <= 1) ? 100 : 1;
  return `${(numbers[0] * scale).toFixed(0)}%–${(numbers[1] * scale).toFixed(0)}%`;
}

function actionLabel(value: unknown): string {
  const action = String(value ?? "WATCH").toUpperCase();
  const labels: Record<string, string> = {
    WATCH: "观察",
    HOLD: "持有",
    TRIAL_BUY: "试仓",
    SCALE_IN: "分批增配",
    ADD: "增配",
    STOP_ADDING: "停止加仓",
    SCALE_OUT: "分批减仓",
    REDUCE: "减仓",
    EXIT: "退出",
  };
  return labels[action] ?? action;
}

function shortDate(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "未标注" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function absoluteTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default DecisionLogPage;
