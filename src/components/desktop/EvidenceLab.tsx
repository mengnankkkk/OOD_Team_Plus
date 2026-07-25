import {
  AlertTriangle,
  Bot,
  CircleHelp,
  Database,
  FileSearch,
  Link2,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

import type { EvidencePack } from "@/types/app/recommendation";

interface EvidenceLabProps {
  evidence: EvidencePack | null;
}

type Row = Record<string, unknown>;

const EvidenceLab = ({ evidence }: EvidenceLabProps) => {
  if (!evidence) return <p className="text-sm text-muted-foreground">尚未生成证据包</p>;

  const support = evidence.evidence.filter((item) => upper(item.stance) === "SUPPORT");
  const counter = evidence.evidence.filter((item) => upper(item.stance) === "COUNTER");
  const missing = evidence.evidence.filter((item) => upper(item.stance) === "MISSING");
  const freshness = upper(evidence.dataFreshness.status ?? "UNKNOWN");
  const blocked = upper(evidence.compliance.status ?? evidence.status) === "BLOCKED";

  return (
    <div className="space-y-8">
      <section className={`border px-5 py-4 ${blocked ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/30"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{blocked ? "本次结论已被发布门拦截" : "本次分析证据摘要"}</p>
            <h2 className="mt-2 text-xl font-semibold">
              {blocked ? "先补齐证据，再考虑下一步动作" : "证据链已生成，可逐项回看"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {blocked
                ? complianceReason(evidence.compliance) || "当前证据不足以支持可执行建议。"
                : "置信度表示证据完整性与一致性，不代表上涨概率。"}
            </p>
          </div>
          {blocked ? <ShieldAlert className="size-7 text-destructive" /> : <ShieldCheck className="size-7 text-primary" />}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-px border border-border bg-border text-sm md:grid-cols-4">
          <SummaryCell label="运行状态" value={statusLabel(evidence.status)} />
          <SummaryCell label="数据新鲜度" value={freshnessLabel(freshness)} />
          <SummaryCell label="多 / 空观点" value={`${support.length} / ${counter.length}`} />
          <SummaryCell label="待补信息" value={String(Math.max(missing.length, evidence.missingEvidence.length))} />
        </dl>
      </section>

      {evidence.missingEvidence.length ? (
        <section aria-labelledby="missing-evidence-title">
          <SectionHeading icon={SearchX} title="还缺什么" subtitle="这些缺口会影响建议能否落地" id="missing-evidence-title" />
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {evidence.missingEvidence.map((item) => (
              <li key={item} className="flex gap-3 py-3 text-sm">
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-[hsl(var(--status-watch))]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="evidence-board-title">
        <SectionHeading icon={FileSearch} title="多空辩论" subtitle="多方、空方和缺失信息分开展示" id="evidence-board-title" />
        <div className="mt-4 grid gap-6 xl:grid-cols-2">
          <EvidenceColumn title="多方观点" tone="support" rows={support} empty="本次没有形成多方观点。" />
          <EvidenceColumn title="空方观点" tone="counter" rows={counter} empty="本次没有形成空方观点，需要重新分析。" />
        </div>
        {missing.length ? (
          <div className="mt-6">
            <EvidenceColumn title="Agent 明确标记的缺失信息" tone="missing" rows={missing} empty="" />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="agent-trace-title">
        <SectionHeading icon={Bot} title="多 Agent 协作轨迹" subtitle="只展示可审计的任务、公开结论和调用关系" id="agent-trace-title" />
        {evidence.agentTrace.length ? (
          <ol className="mt-4 divide-y divide-border border-y border-border">
            {evidence.agentTrace.map((item, index) => (
              <li key={text(item.id, String(index))} className="grid gap-3 py-4 md:grid-cols-[36px_180px_1fr_auto] md:items-start">
                <span className="grid size-7 place-items-center border border-border bg-muted font-mono text-xs">{index + 1}</span>
                <div>
                  <p className="font-mono text-xs font-semibold">{agentLabel(item.agent)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.parentRunId ? `由 ${shortId(item.parentRunId)} 委派` : "根 Agent"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium">{text(item.purpose, text(item.inputSummary, "未记录任务说明"))}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{text(item.summary, failureMessage(item) || "未记录公开结论")}</p>
                </div>
                <StatusBadge value={item.status} />
              </li>
            ))}
          </ol>
        ) : <EmptyLine text="本次运行没有可展示的 Agent 轨迹。" />}
      </section>

      <section aria-labelledby="data-chain-title">
        <SectionHeading icon={Database} title="数据与工具链" subtitle="PandaData、QuantSkills 与内部工具的真实调用结果" id="data-chain-title" />
        <div className="mt-4 grid gap-6 xl:grid-cols-2">
          <TraceGroup title="Skill 运行" rows={evidence.skillRuns} render={renderSkillRun} empty="本次没有调用 Skill。" />
          <TraceGroup title="PandaData 探测" rows={evidence.pandadataProbes} render={renderProbe} empty="本次没有 PandaData 探测记录。" />
          <TraceGroup title="工具调用" rows={evidence.toolCalls} render={renderToolCall} empty="本次没有工具调用。" />
          <TraceGroup title="市场快照" rows={evidence.marketSnapshots} render={renderSnapshot} empty="本次没有形成可用市场快照。" />
        </div>
      </section>

      {evidence.conflicts.length ? (
        <section aria-labelledby="agent-conflicts-title">
          <SectionHeading icon={AlertTriangle} title="Agent 分歧" subtitle="尚未解决的分歧会阻止建议升级" id="agent-conflicts-title" />
          <div className="mt-3 divide-y divide-border border-y border-border">
            {evidence.conflicts.map((item, index) => (
              <div key={text(item.id, String(index))} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{text(item.summary, "未命名分歧")}</p>
                  <StatusBadge value={item.status} />
                </div>
                {item.resolution ? <p className="mt-1 text-xs text-muted-foreground">{text(item.resolution)}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="compliance-title">
        <SectionHeading icon={blocked ? ShieldAlert : ShieldCheck} title="风险与合规发布门" subtitle="模型不能绕过这个节点" id="compliance-title" />
        <div className={`mt-3 border px-4 py-4 ${blocked ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{blocked ? "风险与合规发布门已阻断该建议。" : "风险与合规检查已完成。"}</p>
            <StatusBadge value={evidence.compliance.status ?? evidence.status} />
          </div>
          {array(evidence.compliance.reasons).length ? (
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {array(evidence.compliance.reasons).map((reason) => <li key={String(reason)}>• {String(reason)}</li>)}
            </ul>
          ) : null}
        </div>
      </section>

      <p className="border-t border-border pt-4 text-[11px] text-muted-foreground">
        {evidence.disclaimer || "所有数据仅用于研究与教育目的，历史指标不代表未来表现。"}
      </p>
    </div>
  );
};

function EvidenceColumn({ title, tone, rows, empty }: { title: string; tone: "support" | "counter" | "missing"; rows: Row[]; empty: string }) {
  const accent = tone === "support" ? "border-l-primary" : tone === "counter" ? "border-l-destructive" : "border-l-[hsl(var(--status-watch))]";
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length ? (
        <div className="mt-3 divide-y divide-border border-y border-border">
          {rows.map((item, index) => (
            <article key={text(item.id, String(index))} className={`border-l-2 py-4 pl-4 ${accent}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{evidenceTitle(item.title)}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{text(item.summary, "未提供摘要")}</p>
                </div>
                <span className="border border-border px-2 py-1 text-[10px] text-muted-foreground">{qualityLabel(item.quality)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{timeLabel(item.timeBasis, item.stance)}：{dateLabel(item.dataAsOf)}</span>
                {item.confidenceBps != null ? <span>证据完整度：{Math.round(number(item.confidenceBps) / 100)}%</span> : null}
              </div>
              <SourceList sources={asRows(item.sources)} />
            </article>
          ))}
        </div>
      ) : <EmptyLine text={empty} />}
    </div>
  );
}

function SourceList({ sources }: { sources: Row[] }) {
  if (!sources.length) return <p className="mt-3 text-xs text-[hsl(var(--status-watch))]">尚未绑定可追溯来源</p>;
  return (
    <ul className="mt-3 space-y-2">
      {sources.map((source, index) => (
        <li key={`${text(source.reference, "source")}-${index}`} className="border border-border bg-muted/30 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="size-3.5 text-primary" />
            <span className="font-medium">{sourceLabel(source.type)}</span>
            <span>{referenceLabel(source.reference)}</span>
            {source.freshness ? <StatusBadge value={source.freshness} /> : null}
          </div>
          <p className="mt-1 text-muted-foreground">{timeLabel(source.timeBasis)}：{dateLabel(source.dataAsOf)}</p>
          {source.excerpt ? <p className="mt-1 leading-5 text-muted-foreground">{text(source.excerpt)}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function TraceGroup({ title, rows, render, empty }: { title: string; rows: Row[]; render: (row: Row) => React.ReactNode; empty: string }) {
  return (
    <div className="border-t-2 border-foreground pt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length ? <div className="mt-2 divide-y divide-border">{rows.map((row, index) => <div key={text(row.id, String(index))}>{render(row)}</div>)}</div> : <EmptyLine text={empty} compact />}
    </div>
  );
}

function renderSkillRun(row: Row) {
  const skill = asRow(row.skill);
  return <TraceRow icon={TerminalSquare} title={`${skillLabel(skill.slug)} · ${methodLabel(row.method)}`} status={row.status} detail={`${qualityLabel(row.quality)} · ${timeLabel(row.timeBasis)} ${dateLabel(row.dataAsOf)}`} error={failureMessage(row)} />;
}

function renderProbe(row: Row) {
  return <TraceRow icon={Database} title={`${methodLabel(row.method)} · ${phaseLabel(row.phase)}`} status={row.status} detail={`耗时 ${text(row.durationMs, "-")} ms · ${timeLabel(row.timeBasis)} ${dateLabel(row.dataAsOf)}`} error={failureMessage(row)} />;
}

function renderToolCall(row: Row) {
  const source = asRow(row.source);
  return <TraceRow icon={TerminalSquare} title={toolLabel(row.toolName)} status={row.status} detail={`${sourceLabel(source.code)} · ${text(row.outputSummary, "未生成输出摘要")}`} error={failureMessage(row)} />;
}

function renderSnapshot(row: Row) {
  const instrument = asRow(row.instrument);
  const source = asRow(row.source);
  return <TraceRow icon={Database} title={`${text(instrument.name, text(instrument.symbol, "市场快照"))}`} status={row.freshness} detail={`${sourceLabel(source.code)} / ${methodLabel(source.method)} · ${dateLabel(row.asOf)}`} />;
}

function TraceRow({ icon: Icon, title, status, detail, error }: { icon: typeof Bot; title: string; status: unknown; detail: string; error?: string }) {
  return (
    <div className="flex gap-3 py-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="break-words font-medium">{title}</p>
          <StatusBadge value={status} />
        </div>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{detail}</p>
        {error ? <p className="mt-1 break-words text-xs leading-5 text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, subtitle, id }: { icon: typeof Bot; title: string; subtitle: string; id: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-5 text-primary" />
      <div>
        <h2 id={id} className="text-lg font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return <div className="bg-card px-3 py-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}

function StatusBadge({ value }: { value: unknown }) {
  const status = upper(value);
  const good = ["COMPLETED", "SUCCEEDED", "PASSED", "FRESH", "ACTIVE"].includes(status);
  const bad = ["FAILED", "BLOCKED", "UNAVAILABLE", "INTERRUPTED", "STALE"].includes(status);
  return (
    <span className={`shrink-0 border px-2 py-0.5 text-[10px] ${good ? "border-primary/30 bg-primary/5 text-primary" : bad ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border text-muted-foreground"}`}>
      {statusLabel(status)}
    </span>
  );
}

function EmptyLine({ text: value, compact = false }: { text: string; compact?: boolean }) {
  return <p className={`${compact ? "mt-2 py-3" : "mt-3 border-y border-dashed border-border py-6"} text-sm text-muted-foreground`}>{value}</p>;
}

function complianceReason(compliance: Row) {
  return array(compliance.reasons).map(String).join("；");
}

function failureMessage(row: Row) {
  const error = asRow(row.error);
  const failure = asRow(row.failure);
  return text(error.message, text(failure.message, ""));
}

function statusLabel(value: unknown) {
  const labels: Record<string, string> = {
    ACTIVE: "可参考",
    BLOCKED: "已阻断",
    CANCELLED: "已取消",
    COMPLETED: "已完成",
    DEGRADED: "降级输出",
    FAILED: "失败",
    FRESH: "新鲜",
    INTERRUPTED: "已中断",
    LATER: "稍后处理",
    PENDING: "等待中",
    QUEUED: "排队中",
    REJECTED: "已拒绝",
    REVOKED: "已撤销",
    RUNNING: "运行中",
    SIMULATED: "已模拟采纳",
    STALE: "已过期",
    SUCCEEDED: "成功",
    UNAVAILABLE: "不可用",
    UNKNOWN: "未知",
  };
  const normalized = upper(value);
  return labels[normalized] ?? normalized;
}

function freshnessLabel(value: string) {
  if (value === "FRESH") return "数据新鲜";
  if (value === "STALE") return "数据已过期";
  if (value === "UNAVAILABLE") return "行情不可用";
  if (value === "NOT_REQUIRED") return "本次无需行情";
  return "未确认";
}

function qualityLabel(value: unknown) {
  const quality = upper(value);
  if (quality === "HIGH") return "高完整度";
  if (quality === "MEDIUM") return "中等完整度";
  if (quality === "LOW") return "低完整度";
  if (quality === "UNAVAILABLE") return "不可用";
  return quality || "未评级";
}

function agentLabel(value: unknown) {
  const labels: Record<string, string> = {
    CHIEF_ADVISOR: "总顾问",
    PROFILE_CONTEXT: "画像顾问",
    DATA_RESEARCH: "市场研究",
    PORTFOLIO_RISK: "组合风险",
    RECOMMENDATION: "建议生成",
    COMPLIANCE_REVIEWER: "风险与合规",
    EXPLANATION_REPORT: "解释报告",
    BRANCH_SCENARIO_CHIEF_ADVISOR: "分支情景总顾问",
  };
  const normalized = upper(value);
  return labels[normalized] ?? text(value, "Agent").replaceAll("_", " ");
}

function evidenceTitle(value: unknown) {
  const normalized = upper(value);
  if ([
    "CHIEF_ADVISOR",
    "PROFILE_CONTEXT",
    "DATA_RESEARCH",
    "PORTFOLIO_RISK",
    "RECOMMENDATION",
    "COMPLIANCE_REVIEWER",
    "EXPLANATION_REPORT",
  ].includes(normalized)) return agentLabel(normalized);
  if (["DERIVED_ENGINE", "PANDADATA", "PANDADATA_API"].includes(normalized)) return sourceLabel(normalized);
  return text(value, "未命名证据");
}

function dateLabel(value: unknown) {
  if (!value) return "时间待补";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN");
}

function sourceLabel(value: unknown) {
  const labels: Record<string, string> = {
    DERIVED_ENGINE: "组合计算引擎",
    PANDADATA: "PandaData 行情数据",
    PANDADATA_API: "PandaData 行情数据",
    SOURCE_PANDADATA_API: "PandaData 行情数据",
    SOURCE_DERIVED_ENGINE: "组合计算引擎",
    INTERNAL: "内部数据",
    UNKNOWN: "未知来源",
  };
  const normalized = upper(value).replaceAll("-", "_");
  return labels[normalized] ?? labels[normalized.replace(/^SOURCE_/u, "")] ?? text(value, "未知来源");
}

function skillLabel(value: unknown) {
  const labels: Record<string, string> = {
    "pandadata-api": "PandaData 数据技能",
    "pandadata_api": "PandaData 数据技能",
  };
  const normalized = String(value ?? "").toLowerCase();
  return labels[normalized] ?? "数据技能";
}

function methodLabel(value: unknown) {
  const labels: Record<string, string> = {
    get_us_daily: "美股日线行情",
    get_stock_daily: "A 股日线行情",
    get_cn_daily: "A 股日线行情",
    get_hk_daily: "港股日线行情",
    get_index_daily: "指数日线行情",
    get_etf_daily: "ETF 日线行情",
    pandadata: "PandaData 行情查询",
    "pandadata-unavailable": "PandaData 行情查询",
  };
  const normalized = String(value ?? "").toLowerCase();
  return labels[normalized] ?? text(value, "未记录方法").replaceAll("_", " ");
}

function referenceLabel(value: unknown) {
  const raw = text(value, "未提供来源定位");
  if (raw.startsWith("agent:")) return agentLabel(raw.slice("agent:".length));
  return methodLabel(raw);
}

function phaseLabel(value: unknown) {
  const labels: Record<string, string> = {
    LIVE_CALL: "实时调用",
    DRY_RUN: "参数校验",
  };
  const normalized = upper(value);
  return labels[normalized] ?? statusLabel(normalized);
}

function toolLabel(value: unknown) {
  const labels: Record<string, string> = {
    pandadata: "PandaData 数据工具",
    panda_data: "PandaData 数据工具",
  };
  const normalized = String(value ?? "").toLowerCase();
  return labels[normalized] ?? text(value, "未命名工具").replaceAll("_", " ");
}

function timeLabel(basis: unknown, stance?: unknown) {
  const normalized = upper(basis);
  if (normalized === "MARKET_DATA") return "市场数据截至";
  if (normalized === "SOURCE_VERIFIED") return "行情核验时间";
  if (normalized === "PORTFOLIO_SNAPSHOT") return "组合快照截至";
  if (normalized === "PROFILE_SNAPSHOT") return "画像核验时间";
  if (upper(stance) === "MISSING") return "缺口识别时间";
  return "证据生成时间";
}

function shortId(value: unknown) {
  const id = String(value ?? "");
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
}

function text(value: unknown, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function upper(value: unknown) {
  return String(value ?? "").toUpperCase();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

export default EvidenceLab;
