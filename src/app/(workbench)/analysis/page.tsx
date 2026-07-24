"use client";

import { RefreshCw, RotateCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { ErrorBlock, LoadingBlock, MetricCard, PageHeading, Sparkline, Status, useApiResource } from "@/features/workbench/components/shared";
import { apiMutation, money, percent } from "@/features/workbench/lib/api";

type Holding = { holdingId: string; symbol: string; name: string; assetType: string; sector: string; quantity: string; averageCost: string; marketPrice: string; marketValue: string; weight: number; unrealizedPnl: string; unrealizedPnlRate: number; drawdown: number };
type Holdings = { portfolioSnapshotId: string; summary: { totalValue: string; cashValue: string; unrealizedPnl: string }; items: Holding[]; dataQuality: string; asOf: string };
type Metrics = { portfolioId: string; healthScore: number; riskScore: number; scoreVersion: string; metrics: Record<string, number>; allocation: { bySector: Array<{ name: string; value: number; weight: number }>; byAssetType: Array<{ name: string; value: number; weight: number }> }; components: Array<{ code: string; score: number }>; observationCount: number };
type Trends = { trends: Array<{ metric: string; points: Array<{ date: string; value: number }> }>; source: string; observationCount: number };

const COMPONENT_NAMES: Record<string, string> = { RETURNSCORE: "收益质量", DRAWDOWNSCORE: "回撤韧性", VOLATILITYSCORE: "波动控制", CONCENTRATIONSCORE: "分散程度", LIQUIDITYSCORE: "流动性" };

export default function AnalysisPage() {
  const holdings = useApiResource<Holdings>("/api/v1/portfolio-analysis/holdings");
  const metrics = useApiResource<Metrics>("/api/v1/portfolio-analysis/metrics");
  const trends = useApiResource<Trends>("/api/v1/portfolio-analysis/trends");
  const [syncing, setSyncing] = useState(false); const [notice, setNotice] = useState("");
  const reload = () => { void holdings.reload(); void metrics.reload(); void trends.reload(); };
  const sync = async () => {
    if (!metrics.data?.portfolioId) return; setSyncing(true); setNotice("");
    try { await apiMutation("/api/v1/portfolio-analysis/refresh", "POST", { portfolioId: metrics.data.portfolioId }); setNotice("行情快照已更新，指标已重新计算。"); reload(); }
    catch (error) { setNotice(`${error instanceof Error ? error.message : "同步失败"}。本地指标仍可正常使用。`); }
    finally { setSyncing(false); }
  };
  if (holdings.loading || metrics.loading) return <LoadingBlock label="正在计算组合健康度与风险敞口" />;
  if (holdings.error || metrics.error) return <ErrorBlock message={holdings.error || metrics.error} retry={reload} />;
  const m = metrics.data; const h = holdings.data;
  const returnPoints = trends.data?.trends.find((item) => item.metric === "total_return")?.points.map((point) => point.value) ?? [];
  const drawdownPoints = trends.data?.trends.find((item) => item.metric === "drawdown")?.points.map((point) => point.value) ?? [];
  return <div className="page-stack">
    <PageHeading eyebrow="PORTFOLIO DIAGNOSTICS / 组合诊断" title="静态资产分析" description="收益、回撤、波动、集中度和流动性使用同一组合快照计算；历史不足时明确采用成本基线。" actions={<><button className="button ghost" onClick={reload}><RotateCw size={15} />重新计算</button><button className="button primary" onClick={() => void sync()} disabled={syncing}><RefreshCw className={syncing ? "spin" : ""} size={15} />同步行情</button></>} />
    {notice ? <div className="inline-notice"><ShieldAlert size={16} />{notice}</div> : null}
    <section className="analysis-scoreboard">
      <div className="score-block health"><span>HEALTH</span><strong>{m?.healthScore ?? 0}</strong><small>组合健康度</small></div>
      <div className="score-block risk"><span>RISK</span><strong>{m?.riskScore ?? 0}</strong><small>风险温度</small></div>
      <div className="score-components">{m?.components.map((item) => <div key={item.code}><span>{COMPONENT_NAMES[item.code] ?? item.code}</span><div><i style={{ width: `${item.score}%` }} /></div><b>{item.score}</b></div>)}</div>
      <div className="quality-card"><Status tone={h?.dataQuality === "COMPLETE" ? "good" : "warn"}>{h?.dataQuality}</Status><h3>口径说明</h3><p>基于 {m?.observationCount ?? 0} 个本地组合快照；价格同步失败不会覆盖现有快照。</p><small>模型 {m?.scoreVersion}</small></div>
    </section>
    <section className="metric-grid four">
      <MetricCard label="总资产" value={money(m?.metrics.totalValue)} note={`现金 ${money(m?.metrics.cashValue)}`} />
      <MetricCard label="累计收益" value={percent(m?.metrics.totalReturn)} tone={(m?.metrics.totalReturn ?? 0) >= 0 ? "positive" : "warning"} note="持仓成本 + 现金口径" />
      <MetricCard label="最大回撤" value={percent(m?.metrics.maxDrawdown)} tone="warning" note="历史快照 / 成本基线" />
      <MetricCard label="年化波动" value={percent(m?.metrics.annualVolatility)} note="收益序列或截面估算" />
    </section>
    <section className="analysis-grid">
      <article className="panel trend-panel"><div className="panel-heading"><div><span>PERFORMANCE TRACE</span><h2>收益与回撤</h2></div><Status>{trends.data?.source ?? "LOCAL"}</Status></div><div className="big-spark"><Sparkline values={returnPoints} /><div><span>累计收益</span><strong>{percent(m?.metrics.totalReturn)}</strong></div></div><div className="mini-trend"><span>回撤轨迹</span><Sparkline values={drawdownPoints} tone="orange" /><b>{percent(m?.metrics.maxDrawdown)}</b></div></article>
      <article className="panel allocation-panel"><div className="panel-heading"><div><span>EXPOSURE MAP</span><h2>行业配置</h2></div><b>HHI {(m?.metrics.concentrationHhi ?? 0).toFixed(3)}</b></div><div className="allocation-list">{m?.allocation.bySector.map((item) => <div key={item.name}><span>{item.name}</span><div><i style={{ width: `${item.weight * 100}%` }} /></div><b>{percent(item.weight)}</b><small>{money(item.value)}</small></div>)}</div></article>
    </section>
    <section className="panel data-panel"><div className="panel-heading"><div><span>POSITION LEDGER</span><h2>持仓明细</h2></div><span>{h?.items.length ?? 0} 个标的</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>标的</th><th>类型 / 行业</th><th>数量</th><th>成本 / 现价</th><th>市值</th><th>仓位</th><th>浮盈亏</th><th>回撤</th></tr></thead><tbody>{h?.items.map((item) => <tr key={item.holdingId}><td><b>{item.symbol}</b><small>{item.name}</small></td><td><Status>{item.assetType}</Status><small>{item.sector}</small></td><td>{Number(item.quantity).toLocaleString()}</td><td><span>{money(item.averageCost)}</span><small>{money(item.marketPrice)}</small></td><td><b>{money(item.marketValue)}</b></td><td>{percent(item.weight)}</td><td className={item.unrealizedPnlRate >= 0 ? "positive" : "negative"}><b>{money(item.unrealizedPnl)}</b><small>{percent(item.unrealizedPnlRate)}</small></td><td className="negative">{percent(item.drawdown)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
