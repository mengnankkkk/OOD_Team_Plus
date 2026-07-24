"use client";

import { ArrowDownRight, GitBranch, Play, Plus, RotateCcw, ShieldCheck, Split, WandSparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, Status, useApiResource } from "@/features/workbench/components/shared";
import { apiGet, apiMutation, money, percent, shortDate } from "@/features/workbench/lib/api";

type WorkspaceSummary = { id: string; name: string; objectiveText: string; status: string; activeBranchId: string; version: number; updatedAt: string };
type Branch = { id: string; parentBranchId: string | null; label: string; depth: number; status: string };
type Workspace = { id: string; name: string; objectiveText: string; status: string; portfolioSnapshotId: string; rootBranchId: string; activeBranchId: string; branches: Branch[]; version: number };
type Forecast = { expectedReturn: number; bullCaseReturn: number; bearCaseReturn: number; annualVolatility: number; maxDrawdown: number; concentrationHHI: number };
type Option = { id: string; label: string; summary: string; trades: Array<{ instrumentId: string; action: string; quantity: string }>; analysis: { strategy: string; riskLevel: "LOW" | "MEDIUM" | "HIGH"; forecast: Forecast; rationale: string[]; counterEvidence: string[]; risks: string[]; assumptions: string[] } };
type Snapshot = { cash: string; totalValue: string; holdings: Array<{ instrumentId: string; marketValue: string; weightBps: number }>; metrics: Forecast & { riskLevel?: string }; dataAsOf: string; engineVersion: string };

export default function SimulationsPage() {
  const holdings = useApiResource<{ portfolioSnapshotId: string }>("/api/v1/portfolio-analysis/holdings");
  const list = useApiResource<{ items: WorkspaceSummary[] }>("/api/v1/simulation-workspaces?limit=20");
  const [selected, setSelected] = useState("");
  useEffect(() => { if (!selected && list.data?.items[0]) setSelected(list.data.items[0].id); }, [list.data, selected]);
  const workspace = useApiResource<Workspace>(selected ? `/api/v1/simulation-workspaces/${selected}` : null);
  const options = useApiResource<{ items: Option[] }>(selected ? `/api/v1/simulation-workspaces/${selected}/options` : null);
  const snapshot = useApiResource<Snapshot>(workspace.data ? `/api/v1/simulation-workspaces/${workspace.data.id}/branches/${workspace.data.activeBranchId}/snapshot` : null);
  const [label, setLabel] = useState("组合再平衡实验"); const [objective, setObjective] = useState("降低组合集中度和最大回撤，同时保留中长期收益能力");
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const createWorkspace = async (event: FormEvent) => {
    event.preventDefault(); if (!holdings.data?.portfolioSnapshotId) return; setBusy("create"); setError("");
    try { const data = await apiMutation<{ id: string }>("/api/v1/simulation-workspaces", "POST", { label, objectiveText: objective, portfolioSnapshotId: holdings.data.portfolioSnapshotId }); setSelected(data.id); await list.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); } finally { setBusy(""); }
  };
  const generate = async () => {
    if (!workspace.data) return; setBusy("generate"); setError("");
    try { await apiMutation(`/api/v1/simulation-workspaces/${workspace.data.id}/options`, "POST", { objective }); await options.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败"); } finally { setBusy(""); }
  };
  const execute = async (option: Option) => {
    if (!workspace.data) return; setBusy(option.id); setError("");
    try { await apiMutation(`/api/v1/simulation-workspaces/${workspace.data.id}/branches`, "POST", { parentBranchId: workspace.data.activeBranchId, optionId: option.id, name: option.label }); await workspace.reload(); await options.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "执行失败"); } finally { setBusy(""); }
  };
  const switchBranch = async (branchId: string) => {
    if (!workspace.data || branchId === workspace.data.activeBranchId) return; setBusy(branchId); setError("");
    try { await apiMutation(`/api/v1/simulation-workspaces/${workspace.data.id}/active-branch`, "PATCH", { branchId }, { "If-Match": String(workspace.data.version) }); await workspace.reload(); await options.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "切换失败"); } finally { setBusy(""); }
  };
  const undo = async () => {
    if (!workspace.data) return; setBusy("undo"); setError("");
    try { await apiMutation(`/api/v1/simulation-workspaces/${workspace.data.id}/undo`, "POST", {}, { "If-Match": String(workspace.data.version) }); await workspace.reload(); await options.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法撤回"); } finally { setBusy(""); }
  };
  if (list.loading || holdings.loading) return <LoadingBlock label="正在装载分支实验室" />;
  return <div className="page-stack simulation-page">
    <PageHeading eyebrow="SCENARIO BRANCH LAB / 分支实验室" title="在真实操作之前，先走一遍不同的未来" description="每个分支冻结同一批价格与假设，可执行、切换和撤回；不会产生真实订单。" actions={workspace.data && workspace.data.activeBranchId !== workspace.data.rootBranchId ? <button className="button ghost" onClick={() => void undo()} disabled={Boolean(busy)}><RotateCcw size={15} />撤回到父分支</button> : undefined} />
    {error ? <ErrorBlock message={error} /> : null}
    <section className="simulation-layout">
      <aside className="panel workspace-sidebar"><div className="panel-heading"><div><span>WORKSPACES</span><h2>实验工作区</h2></div><Plus size={17} /></div><div className="workspace-list">{list.data?.items.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}><GitBranch size={16} /><span><b>{item.name}</b><small>{shortDate(item.updatedAt)}</small></span><Status tone={item.status === "ACTIVE" ? "good" : "neutral"}>{item.status}</Status></button>)}</div><form className="create-workspace" onSubmit={(event) => void createWorkspace(event)}><label>新实验名称<input value={label} onChange={(event) => setLabel(event.target.value)} /></label><label>优化目标<textarea rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} /></label><button className="button primary" disabled={busy === "create" || !holdings.data}>{busy === "create" ? "创建中…" : <><Plus size={15} />创建工作区</>}</button></form></aside>
      <div className="simulation-main">
        {!selected ? <EmptyBlock title="还没有模拟工作区" detail="从左侧输入目标，创建第一棵资产分支树。" /> : workspace.loading ? <LoadingBlock /> : workspace.error ? <ErrorBlock message={workspace.error} retry={workspace.reload} /> : workspace.data ? <>
          <section className="panel branch-map"><div className="panel-heading"><div><span>BRANCH MAP</span><h2>{workspace.data.name}</h2><p>{workspace.data.objectiveText}</p></div><Status tone="good"><ShieldCheck size={12} /> NO ORDERS</Status></div><div className="branch-tree">{workspace.data.branches.map((branch) => <button key={branch.id} style={{ marginLeft: `${branch.depth * 44}px` }} className={branch.id === workspace.data?.activeBranchId ? "active" : ""} onClick={() => void switchBranch(branch.id)} disabled={Boolean(busy)}><span className="branch-line" /><Split size={16} /><span><b>{branch.label}</b><small>深度 {branch.depth} · {branch.id.slice(-6)}</small></span>{branch.id === workspace.data?.activeBranchId ? <Status tone="good">当前</Status> : <ArrowDownRight size={14} />}</button>)}</div></section>
          {snapshot.data ? <section className="branch-summary"><div><span>分支资产</span><strong>{money(Number(snapshot.data.cash) + Number(snapshot.data.totalValue))}</strong></div><div><span>预期收益</span><strong>{percent(snapshot.data.metrics.expectedReturn ?? 0)}</strong></div><div><span>压力回撤</span><strong className="negative">{percent(snapshot.data.metrics.maxDrawdown ?? 0)}</strong></div><div><span>集中度 HHI</span><strong>{Number(snapshot.data.metrics.concentrationHHI ?? 0).toFixed(3)}</strong></div><div><span>模型</span><strong>{snapshot.data.engineVersion}</strong></div></section> : null}
          <section className="option-section"><div className="option-title"><div><span>GENERATE A / B / C</span><h2>下一步候选方案</h2><p>候选基于当前激活分支，而不是初始组合。</p></div><button className="button primary" onClick={() => void generate()} disabled={Boolean(busy)}><WandSparkles size={15} />{busy === "generate" ? "正在分析…" : "生成新一轮方案"}</button></div>{options.data?.items.length ? <div className="option-grid">{options.data.items.map((option) => <article className="option-card" key={option.id}><div className="option-card-head"><Status tone={option.analysis.riskLevel === "LOW" ? "good" : option.analysis.riskLevel === "HIGH" ? "danger" : "warn"}>{option.analysis.riskLevel}</Status><span>{option.analysis.strategy}</span></div><h3>{option.label}</h3><p>{option.summary}</p><div className="scenario-range"><div><span>熊市</span><b className="negative">{percent(option.analysis.forecast.bearCaseReturn)}</b></div><div><span>基准</span><b>{percent(option.analysis.forecast.expectedReturn)}</b></div><div><span>牛市</span><b className="positive">{percent(option.analysis.forecast.bullCaseReturn)}</b></div></div><dl><div><dt>年化波动</dt><dd>{percent(option.analysis.forecast.annualVolatility)}</dd></div><div><dt>最大回撤</dt><dd>{percent(option.analysis.forecast.maxDrawdown)}</dd></div><div><dt>集中度</dt><dd>{option.analysis.forecast.concentrationHHI.toFixed(3)}</dd></div><div><dt>模拟交易</dt><dd>{option.trades.length} 笔</dd></div></dl><details><summary>依据、反方证据与假设</summary><ul>{option.analysis.rationale.map((item) => <li key={item}>{item}</li>)}</ul><p className="counter">反方：{option.analysis.counterEvidence[0]}</p><small>{option.analysis.assumptions.join(" · ")}</small></details><button className="button option-run" onClick={() => void execute(option)} disabled={Boolean(busy)}><Play size={14} />{busy === option.id ? "正在执行…" : "在新分支中执行"}</button></article>)}</div> : <EmptyBlock title="当前分支还没有候选" detail="点击生成新一轮方案，系统会给出保持、均衡和情景导向三个候选。" />}</section>
        </> : null}
      </div>
    </section>
  </div>;
}
