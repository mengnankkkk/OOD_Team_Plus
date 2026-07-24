import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, CircleCheck, CircleAlert, Cog, Database, Sparkles, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdvisorTrace as AdvisorTraceModel, TraceSpan, TraceSpanKind } from "@/types/app/onboarding";

const kindMeta: Record<TraceSpanKind, { icon: React.ComponentType<{ className?: string }>; label: string; tint: string }> = {
  llm: { icon: Sparkles, label: "LLM 推理", tint: "text-primary" },
  tool: { icon: Cog, label: "工具调用", tint: "text-[hsl(var(--status-watch))]" },
  reasoning: { icon: Brain, label: "内部推理", tint: "text-muted-foreground" },
  io: { icon: Database, label: "输入输出", tint: "text-muted-foreground" },
};

interface Props {
  trace: AdvisorTraceModel;
  defaultOpen?: boolean;
}

const AdvisorTrace = ({ trace, defaultOpen = false }: Props) => {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleSpan = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const totalSpans = trace.spans.length;
  const hasError = trace.spans.some((s) => s.status === "error");

  return (
    <div className="mt-3 rounded-md border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-xs transition-colors hover:bg-muted/50 sm:items-center"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-muted-foreground">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Brain className="size-3.5 text-primary" />
          <span className="font-medium text-foreground">智能体辩论 · trace {trace.id.slice(-6)}</span>
          <span className="basis-full text-left text-muted-foreground sm:basis-auto">{totalSpans} 步 · {trace.totalMs} ms · {trace.model}</span>
          {hasError && <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">含错误</span>}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3">
          <ol className="relative space-y-2 pl-4">
            <span className="absolute inset-y-1 left-1 w-px bg-border" aria-hidden />
            {trace.spans.map((span, idx) => (
              <SpanRow
                key={span.id}
                span={span}
                index={idx + 1}
                expanded={Boolean(expanded[span.id])}
                onToggle={() => toggleSpan(span.id)}
              />
            ))}
          </ol>

          <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-primary">
              <Terminal className="size-3.5" />
              <span className="font-medium">证据完整性与公开结论</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-5 text-foreground">{trace.finalReply}</p>
          </div>
        </div>
      )}
    </div>
  );
};

const SpanRow = ({ span, index, expanded, onToggle }: { span: TraceSpan; index: number; expanded: boolean; onToggle: () => void }) => {
  const meta = kindMeta[span.kind];
  const Icon = meta.icon;
  return (
    <li className="relative">
      <span className="absolute -left-3 top-2 grid size-3 place-items-center rounded-full border border-border bg-card">
        <span className={cn("size-1.5 rounded-full", span.status === "ok" ? "bg-primary" : "bg-destructive")} />
      </span>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-5 shrink-0 font-mono text-muted-foreground">#{index}</span>
          <Icon className={cn("size-3.5 shrink-0", meta.tint)} />
          <span className="truncate font-medium text-foreground">{span.label}</span>
          <span className="hidden truncate text-muted-foreground sm:inline">· {meta.label}</span>
          {span.tool && <code className="hidden truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">{span.tool}</code>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {span.status === "ok" ? <CircleCheck className="size-3.5 text-[hsl(var(--status-down))]" /> : <CircleAlert className="size-3.5 text-destructive" />}
          <span className="font-mono text-muted-foreground">{span.durationMs} ms</span>
          {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        </span>
      </button>

      {expanded && (
        <div className="ml-7 mt-1 space-y-2 rounded-md border border-border bg-background/60 p-2">
          {span.note && <p className="text-[11px] text-muted-foreground">备注 · {span.note}</p>}
          <JsonBlock title="input" value={span.input} />
          <JsonBlock title="output" value={span.output} />
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
            <span>started {new Date(span.startedAt).toLocaleTimeString("zh-CN", { hour12: false })}</span>
            <span>· duration {span.durationMs} ms</span>
            <span>· status {span.status}</span>
          </div>
        </div>
      )}
    </li>
  );
};

const JsonBlock = ({ title, value }: { title: string; value: unknown }) => {
  const [open, setOpen] = useState(true);
  const text = safeStringify(value);
  const isEmpty = value === null || value === undefined;
  return (
    <div className="rounded-sm border border-border bg-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/40">
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <span className="font-mono uppercase tracking-wider">{title}</span>
          {isEmpty && <span className="text-muted-foreground">(空)</span>}
        </span>
        <span className="font-mono">{text.length} chars</span>
      </button>
      {open && !isEmpty && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-border bg-background/70 px-2 py-1.5 font-mono text-[10px] leading-4 text-foreground">{text}</pre>
      )}
    </div>
  );
};

const safeStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export default AdvisorTrace;
