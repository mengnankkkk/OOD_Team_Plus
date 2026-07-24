"use client";

import { Play, ShieldAlert } from "lucide-react";

import { money, percent } from "../lib/api";
import { Status } from "./shared";

export type BranchOption = {
  id: string;
  label: string;
  summary: string;
  trades: Array<{ instrumentId: string; action: string; quantity: string; price?: string }>;
  analysis: {
    strategy: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    forecast: {
      expectedReturn: number;
      bullCaseReturn: number;
      bearCaseReturn: number;
      annualVolatility: number | null;
      maxDrawdown: number;
      concentrationHHI: number;
    };
    rationale: string[];
    counterEvidence: string[];
    risks: string[];
    assumptions: string[];
    invalidationConditions?: string[];
    provider?: string;
    delegatedAgents?: string[];
  };
};

export function BranchOptionCard({
  option,
  disabled,
  busy,
  onExecute,
}: {
  option: BranchOption;
  disabled: boolean;
  busy: boolean;
  onExecute: () => void;
}) {
  const provider = option.analysis.provider === "CHIEF_ADVISOR" ? "CHIEF ADVISOR" : "规则 fallback";
  const riskTone = option.analysis.riskLevel === "LOW" ? "good" : option.analysis.riskLevel === "HIGH" ? "danger" : "warn";
  return <article className="option-card branch-option-card">
    <div className="option-card-head">
      <Status tone={riskTone}>{option.analysis.riskLevel}</Status>
      <span className="option-provider">{provider}</span>
    </div>
    <h3>{option.label}</h3>
    <p>{option.summary}</p>
    <div className="scenario-range">
      <div><span>熊市压力</span><b className="negative">{percent(option.analysis.forecast.bearCaseReturn)}</b></div>
      <div><span>当前基准</span><b>{percent(option.analysis.forecast.expectedReturn)}</b></div>
      <div><span>牛市压力</span><b className="positive">{percent(option.analysis.forecast.bullCaseReturn)}</b></div>
    </div>
    <dl>
      <div><dt>最大回撤</dt><dd>{percent(option.analysis.forecast.maxDrawdown)}</dd></div>
      <div><dt>组合 HHI</dt><dd>{option.analysis.forecast.concentrationHHI.toFixed(3)}</dd></div>
      <div><dt>模拟成交</dt><dd>{option.trades.length} 笔</dd></div>
      <div><dt>建议动作</dt><dd>{option.analysis.strategy}</dd></div>
    </dl>
    <div className="evidence-list">
      <strong>主要依据</strong>
      <ul>{option.analysis.rationale.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
      <strong>反方证据</strong>
      <p className="counter">{option.analysis.counterEvidence[0] ?? "暂无反方证据"}</p>
      <strong>主要风险</strong>
      <ul>{option.analysis.risks.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
    <details>
      <summary>假设与失效条件</summary>
      <p>{option.analysis.assumptions.join(" · ")}</p>
      {option.analysis.invalidationConditions?.length ? <p>{option.analysis.invalidationConditions.join(" · ")}</p> : null}
      {option.analysis.delegatedAgents?.length ? <small>参与角色：{option.analysis.delegatedAgents.join("、")}</small> : null}
    </details>
    <button className="button option-run" onClick={onExecute} disabled={disabled || busy}>
      {busy ? <><ShieldAlert size={14} />正在计算分支</> : <><Play size={14} />仅在模拟分支中执行</>}
    </button>
  </article>;
}

export function BranchOptionEmptyState({ status }: { status: string }) {
  const message = status === "FAILED" ? "本轮候选生成失败，请重新发起。" : status === "QUEUED" || status === "RUNNING" ? "Agent 正在整理画像、研究和组合风险，候选卡会自动出现。" : "生成一轮候选方案，先比较不同未来，再决定是否执行模拟。";
  return <div className="state-panel"><ShieldAlert size={22} /><strong>{status === "FAILED" ? "候选暂不可用" : status === "QUEUED" || status === "RUNNING" ? "正在生成候选" : "还没有候选方案"}</strong><p>{message}</p></div>;
}

export function optionTradeNotional(option: BranchOption): string {
  const notional = option.trades.reduce((total, trade) => total + Number(trade.quantity) * Number(trade.price ?? 0), 0);
  return money(notional);
}
