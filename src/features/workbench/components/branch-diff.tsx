"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { money, percent } from "../lib/api";

type BranchSnapshot = {
  cash: string;
  totalValue: string;
  totalAssets?: string;
  unrealizedPnl: string;
  holdings: Array<{ instrumentId: string; quantity: string; weightBps: number; marketValue: string }>;
  metrics: { maxDrawdown?: number; concentrationHHI?: number; riskLevel?: string };
};

export function BranchDiff({ parent, child }: { parent: BranchSnapshot | null; child: BranchSnapshot | null }) {
  if (!child) return <div className="state-panel"><p>选择一个已执行的分支后，这里会显示资产变化。</p></div>;
  if (!parent) return <div className="inline-notice">当前分支没有可比的父分支快照。</div>;
  const rows = [
    ["现金", Number(child.cash) - Number(parent.cash), money(Number(child.cash) - Number(parent.cash))],
    ["总资产", Number(child.totalAssets ?? Number(child.cash) + Number(child.totalValue)) - Number(parent.totalAssets ?? Number(parent.cash) + Number(parent.totalValue)), money(Number(child.totalAssets ?? 0) - Number(parent.totalAssets ?? 0))],
    ["浮盈亏", Number(child.unrealizedPnl) - Number(parent.unrealizedPnl), money(Number(child.unrealizedPnl) - Number(parent.unrealizedPnl))],
    ["压力回撤", Number(child.metrics.maxDrawdown ?? 0) - Number(parent.metrics.maxDrawdown ?? 0), percent(Number(child.metrics.maxDrawdown ?? 0) - Number(parent.metrics.maxDrawdown ?? 0))],
    ["集中度 HHI", Number(child.metrics.concentrationHHI ?? 0) - Number(parent.metrics.concentrationHHI ?? 0), (Number(child.metrics.concentrationHHI ?? 0) - Number(parent.metrics.concentrationHHI ?? 0)).toFixed(3)],
  ] as const;
  return <div className="branch-diff">
    {rows.map(([label, delta, formatted]) => <div key={label}><span>{label}</span><strong className={delta > 0 ? "positive" : delta < 0 ? "negative" : ""}>{delta > 0 ? <ArrowUpRight size={13} /> : delta < 0 ? <ArrowDownRight size={13} /> : <Minus size={13} />}{formatted}</strong></div>)}
    <div className="diff-note"><span>风险状态</span><strong>{parent.metrics.riskLevel ?? "—"} → {child.metrics.riskLevel ?? "—"}</strong></div>
  </div>;
}
