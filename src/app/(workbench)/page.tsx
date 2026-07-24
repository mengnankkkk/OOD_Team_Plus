"use client";

import Link from "next/link";
import { ArrowRight, BellRing, DatabaseZap, FileChartColumn, FlaskConical, ShieldCheck } from "lucide-react";
import { ErrorBlock, LoadingBlock, MetricCard, PageHeading, Sparkline, Status, useApiResource } from "@/features/workbench/components/shared";
import { money, percent, shortDate } from "@/features/workbench/lib/api";

type Metrics = { healthScore: number; riskScore: number; metrics: { totalValue: number; unrealizedPnl: number; totalReturn: number; maxDrawdown: number; annualVolatility: number; cashAllocation: number }; dataQuality: string; asOf: string };
type Holdings = { items: Array<{ symbol: string; name: string; marketValue: string; weight: number; unrealizedPnlRate: number }> };
type Trends = { trends: Array<{ metric: string; points: Array<{ value: number }> }> };
type List<T> = { items: T[] };

export default function DashboardPage() {
  const metrics = useApiResource<Metrics>("/api/v1/portfolio-analysis/metrics");
  const holdings = useApiResource<Holdings>("/api/v1/portfolio-analysis/holdings");
  const trends = useApiResource<Trends>("/api/v1/portfolio-analysis/trends");
  const queries = useApiResource<List<{ id: string; question: string; status: string; createdAt: string }>>("/api/v1/data-queries?limit=4");
  const workspaces = useApiResource<List<{ id: string; name: string; status: string; updatedAt: string }>>("/api/v1/simulation-workspaces?limit=4");
  const notifications = useApiResource<{ items: unknown[]; unreadCount: number }>("/api/v1/notifications?unreadOnly=true&limit=4");
  if (metrics.loading || holdings.loading) return <LoadingBlock label="正在整理你的投资驾驶舱" />;
  if (metrics.error || holdings.error) return <ErrorBlock message={metrics.error || holdings.error} retry={() => { void metrics.reload(); void holdings.reload(); }} />;
  const data = metrics.data;
  const returnTrend = trends.data?.trends.find((item) => item.metric === "total_return")?.points.map((point) => point.value) ?? [];
  return <div className="page-stack dashboard-page">
    <PageHeading eyebrow="MORNING LEDGER / 资产晨报" title="你的投资组合，今天处在什么位置？" description={`本地快照 · ${shortDate(data?.asOf)} · 所有评分均展示数据质量与假设`} actions={<Status tone={data?.dataQuality === "COMPLETE" ? "good" : "warn"}>{data?.dataQuality ?? "UNKNOWN"}</Status>} />
    <section className="dashboard-hero">
      <div className="hero-value"><span>组合总资产</span><strong>{money(data?.metrics.totalValue)}</strong><div className="hero-return"><b className={(data?.metrics.totalReturn ?? 0) >= 0 ? "positive" : "negative"}>{percent(data?.metrics.totalReturn)}</b><span>成本口径累计收益</span></div><Sparkline values={returnTrend} /></div>
      <div className="score-orbit"><div className="score-ring" style={{ "--score": `${data?.healthScore ?? 0}%` } as React.CSSProperties}><span>健康度</span><strong>{data?.healthScore ?? 0}</strong><small>/ 100</small></div><div className="score-copy"><span>风险温度</span><b>{data?.riskScore ?? 0}</b><p>{(data?.riskScore ?? 0) > 65 ? "组合风险偏高，建议进入分支实验室测试降波方案。" : "当前风险处于可观察区间，继续关注集中度变化。"}</p><Link href="/analysis">查看完整诊断 <ArrowRight size={14} /></Link></div></div>
    </section>
    <section className="metric-grid four">
      <MetricCard label="未实现盈亏" value={money(data?.metrics.unrealizedPnl)} tone={(data?.metrics.unrealizedPnl ?? 0) >= 0 ? "positive" : "warning"} note="当前持仓成本口径" />
      <MetricCard label="最大回撤" value={percent(data?.metrics.maxDrawdown)} tone="warning" note="本地历史 / 成本基线" />
      <MetricCard label="年化波动" value={percent(data?.metrics.annualVolatility)} note="快照收益序列估算" />
      <MetricCard label="现金比例" value={percent(data?.metrics.cashAllocation)} note="可用于分批配置" />
    </section>
    <section className="dashboard-columns">
      <article className="panel holdings-glance"><div className="panel-heading"><div><span>TOP HOLDINGS</span><h2>持仓重心</h2></div><Link href="/analysis">全部持仓 <ArrowRight size={14} /></Link></div><div className="holding-bars">{holdings.data?.items.slice(0, 5).map((item, index) => <div className="holding-bar" key={item.symbol}><span className="holding-rank">0{index + 1}</span><div><b>{item.symbol}</b><small>{item.name}</small></div><div className="bar-track"><i style={{ width: `${Math.max(4, item.weight * 100)}%` }} /></div><strong>{percent(item.weight)}</strong><em className={item.unrealizedPnlRate >= 0 ? "positive" : "negative"}>{percent(item.unrealizedPnlRate)}</em></div>)}</div></article>
      <article className="panel command-board"><div className="panel-heading"><div><span>NEXT MOVES</span><h2>研究快捷入口</h2></div></div><div className="command-grid">
        <Link href="/query"><DatabaseZap /><span><b>问数据</b><small>自然语言生成安全 SQL</small></span><ArrowRight /></Link>
        <Link href="/simulations"><FlaskConical /><span><b>试分支</b><small>A/B/C 情景比较与撤回</small></span><ArrowRight /></Link>
        <Link href="/artifacts"><FileChartColumn /><span><b>看报告</b><small>图表、Markdown 与版本</small></span><ArrowRight /></Link>
        <Link href="/observatory"><BellRing /><span><b>设观察</b><small>{notifications.data?.unreadCount ?? 0} 条未读提醒</small></span><ArrowRight /></Link>
      </div></article>
    </section>
    <section className="activity-strip"><div><ShieldCheck size={18} /><span><b>安全边界</b><small>只读查询 · 不创建订单 · 情景结果非收益承诺</small></span></div><div><span>最近查数</span><strong>{queries.data?.items.length ?? 0}</strong></div><div><span>模拟工作区</span><strong>{workspaces.data?.items.length ?? 0}</strong></div><div><span>未读提醒</span><strong>{notifications.data?.unreadCount ?? 0}</strong></div></section>
  </div>;
}
