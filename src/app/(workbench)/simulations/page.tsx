"use client";

import { GitBranch, ListTree, Plus, RotateCcw, ShieldCheck, Split, WandSparkles } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { BranchDiff } from "@/features/workbench/components/branch-diff";
import { BranchEventTimeline } from "@/features/workbench/components/branch-event-timeline";
import { BranchOptionCard, BranchOptionEmptyState, type BranchOption } from "@/features/workbench/components/branch-option-card";
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, Status, useApiResource } from "@/features/workbench/components/shared";
import { apiGet, apiMutation, money, percent, shortDate } from "@/features/workbench/lib/api";

type WorkspaceSummary = { id: string; name: string; objectiveText: string; status: string; activeBranchId: string; version: number; updatedAt: string };
type TimelineEvent = { id?: string; event_type?: string; eventType?: string; created_at?: string; createdAt?: string; payload?: Record<string, unknown> };
type Branch = { id: string; parentBranchId: string | null; label: string; depth: number; status: string };
type Workspace = { id: string; name: string; objectiveText: string; status: string; portfolioSnapshotId: string; rootBranchId: string; activeBranchId: string; branches: Branch[]; events: TimelineEvent[]; version: number };
type Snapshot = { cash: string; totalValue: string; totalAssets?: string; costBasis?: string; unrealizedPnl: string; holdings: Array<{ instrumentId: string; quantity: string; cost?: string | null; marketValue: string; weightBps: number }>; metrics: { expectedReturn?: number; maxDrawdown?: number; concentrationHHI?: number; riskLevel?: string }; dataAsOf: string; priceManifestSha256?: string | null; engineVersion: string };
type OptionsPayload = { batchId: string | null; status: string; items: BranchOption[]; provider?: string | null; priceManifest?: { capturedAt?: string; sha256?: string } | null; analysis?: { analysisId: string; streamUrl: string } | null };

export default function SimulationsPage() {
  const holdings = useApiResource<{ portfolioSnapshotId: string }>("/api/v1/portfolio-analysis/holdings");
  const list = useApiResource<{ items: WorkspaceSummary[] }>("/api/v1/simulation-workspaces?limit=20");
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"DECISION_FLOW" | "LAB">("DECISION_FLOW");
  const [label, setLabel] = useState("组合再平衡实验");
  const [objective, setObjective] = useState("降低组合集中度和最大回撤，同时保留中长期收益能力");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selected && list.data?.items[0]) setSelected(list.data.items[0].id);
  }, [list.data, selected]);

  const workspace = useApiResource<Workspace>(selected ? `/api/v1/simulation-workspaces/${selected}` : null);
  const options = useApiResource<OptionsPayload>(selected ? `/api/v1/simulation-workspaces/${selected}/options` : null);
  const activeBranch = workspace.data?.branches.find((branch) => branch.id === workspace.data?.activeBranchId);
  const parentBranchId = activeBranch?.parentBranchId ?? null;
  const snapshot = useApiResource<Snapshot>(workspace.data ? `/api/v1/simulation-workspaces/${workspace.data.id}/branches/${workspace.data.activeBranchId}/snapshot` : null);
  const parentSnapshot = useApiResource<Snapshot>(workspace.data && parentBranchId ? `/api/v1/simulation-workspaces/${workspace.data.id}/branches/${parentBranchId}/snapshot` : null);
  const events = useMemo(() => workspace.data?.events ?? [], [workspace.data?.events]);
  const reloadOptions = options.reload;
  const reloadWorkspace = workspace.reload;

  useEffect(() => {
    const status = options.data?.status;
    if (!["QUEUED", "RUNNING"].includes(status ?? "")) return;
    const timer = setInterval(() => {
      void reloadOptions();
      void reloadWorkspace();
    }, 700);
    return () => clearInterval(timer);
  }, [options.data?.status, reloadOptions, reloadWorkspace]);

  useEffect(() => {
    const streamUrl = options.data?.analysis?.streamUrl;
    if (!streamUrl || !["QUEUED", "RUNNING"].includes(options.data?.status ?? "")) return;
    const source = new EventSource(streamUrl);
    const refresh = () => {
      void reloadOptions();
      void reloadWorkspace();
    };
    ["agent.completed", "branch.options.created", "run.completed", "run.failed"].forEach((eventName) => source.addEventListener(eventName, refresh));
    return () => source.close();
  }, [options.data?.analysis?.streamUrl, options.data?.status, reloadOptions, reloadWorkspace]);

  const createWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (!holdings.data?.portfolioSnapshotId) return;
    setBusy("create"); setError("");
    try {
      const data = await apiMutation<{ id: string }>("/api/v1/simulation-workspaces", "POST", { label, objectiveText: objective, portfolioSnapshotId: holdings.data.portfolioSnapshotId });
      setSelected(data.id);
      await list.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy("");
    }
  };

  const generate = async () => {
    if (!workspace.data) return;
    setBusy("generate"); setError("");
    try {
      const queued = await apiMutation<{ analysis: { analysisId: string } }>(`/api/v1/simulation-workspaces/${workspace.data.id}/options`, "POST", { objective });
      void pollOptionBatch(queued.analysis.analysisId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成失败");
    } finally {
      setBusy("");
    }
  };

  const pollOptionBatch = async (analysisId: string) => {
    if (!workspace.data) return;
    const path = `/api/v1/simulation-workspaces/${workspace.data.id}/options`;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        const latest = await apiGet<OptionsPayload>(path);
        options.setData(latest);
        if (latest.status === "SUCCEEDED" || latest.status === "FAILED") return;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "读取候选状态失败");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setError(`候选生成超时，请通过分析 ${analysisId} 查看运行状态`);
  };

  const execute = async (option: BranchOption) => {
    if (!workspace.data) return;
    setBusy(option.id); setError("");
    try {
      await apiMutation(`/api/v1/simulation-workspaces/${workspace.data.id}/branches`, "POST", { parentBranchId: workspace.data.activeBranchId, optionId: option.id, name: option.label });
      await workspace.reload();
      await options.reload();
      await snapshot.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "执行失败");
    } finally {
      setBusy("");
    }
  };

  const switchBranch = async (branchId: string) => {
    if (!workspace.data || branchId === workspace.data.activeBranchId) return;
    setBusy(branchId); setError("");
    try {
      await apiMutation(`/api/v1/simulation-workspaces/${workspace.data.id}/active-branch`, "PATCH", { branchId }, { "If-Match": String(workspace.data.version) });
      await workspace.reload();
      await options.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "切换失败");
    } finally {
      setBusy("");
    }
  };

  const undo = async () => {
    if (!workspace.data) return;
    setBusy("undo"); setError("");
    try {
      await apiMutation(`/api/v1/simulation-workspaces/${workspace.data.id}/undo`, "POST", {}, { "If-Match": String(workspace.data.version) });
      await workspace.reload();
      await options.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法撤回");
    } finally {
      setBusy("");
    }
  };

  if (list.loading || holdings.loading) return <LoadingBlock label="正在装载分支实验室" />;
  return <div className="page-stack simulation-page">
    <PageHeading
      eyebrow="SCENARIO BRANCH LAB / 分支实验室"
      title="先比较不同未来，再决定是否行动"
      description="候选只影响模拟分支，真实持仓不会被改写。价格、成交数量、费用和资产守恒由服务端确定性计算。"
      actions={<div className="heading-actions"><button className={`button ${mode === "DECISION_FLOW" ? "primary" : "ghost"}`} onClick={() => setMode("DECISION_FLOW")}><ListTree size={15} />决策流</button><button className={`button ${mode === "LAB" ? "primary" : "ghost"}`} onClick={() => setMode("LAB")}><GitBranch size={15} />分支实验室</button>{workspace.data && workspace.data.activeBranchId !== workspace.data.rootBranchId ? <button className="button ghost" onClick={() => void undo()} disabled={Boolean(busy)}><RotateCcw size={15} />撤回</button> : null}</div>}
    />
    {error ? <ErrorBlock message={error} /> : null}
    <section className="simulation-layout">
      <aside className="panel workspace-sidebar">
        <div className="panel-heading"><div><span>WORKSPACES</span><h2>实验工作区</h2></div><Plus size={17} /></div>
        <div className="workspace-list">{list.data?.items.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}><GitBranch size={16} /><span><b>{item.name}</b><small>{shortDate(item.updatedAt)}</small></span><Status tone={item.status === "ACTIVE" ? "good" : "neutral"}>{item.status}</Status></button>)}</div>
        <form className="create-workspace" onSubmit={(event) => void createWorkspace(event)}>
          <label>新实验名称<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label>优化目标<textarea rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
          <button className="button primary" disabled={busy === "create" || !holdings.data}>{busy === "create" ? "创建中…" : <><Plus size={15} />创建工作区</>}</button>
        </form>
      </aside>
      <div className="simulation-main">
        {!selected ? <EmptyBlock title="还没有模拟工作区" detail="输入一个目标，创建第一棵资产分支树。" /> : workspace.loading ? <LoadingBlock /> : workspace.error ? <ErrorBlock message={workspace.error} retry={workspace.reload} /> : workspace.data ? <>
          <section className="panel branch-map">
            <div className="panel-heading"><div><span>ACTIVE SCENARIO</span><h2>{workspace.data.name}</h2><p>{workspace.data.objectiveText}</p></div><Status tone="good"><ShieldCheck size={12} /> SIMULATION ONLY</Status></div>
            <div className="branch-tree">{workspace.data.branches.map((branch) => <button key={branch.id} style={{ marginLeft: `${branch.depth * 30}px` }} className={branch.id === workspace.data?.activeBranchId ? "active" : ""} onClick={() => void switchBranch(branch.id)} disabled={Boolean(busy)}><span className="branch-line" /><Split size={16} /><span><b>{branch.label}</b><small>深度 {branch.depth} · {branch.id.slice(-6)}</small></span>{branch.id === workspace.data?.activeBranchId ? <Status tone="good">当前</Status> : null}</button>)}</div>
          </section>
          {snapshot.data ? <section className="branch-summary"><div><span>模拟总资产</span><strong>{money(Number(snapshot.data.totalAssets ?? Number(snapshot.data.cash) + Number(snapshot.data.totalValue)))}</strong></div><div><span>浮盈亏</span><strong className={Number(snapshot.data.unrealizedPnl) >= 0 ? "positive" : "negative"}>{money(snapshot.data.unrealizedPnl)}</strong></div><div><span>压力回撤</span><strong className="negative">{percent(snapshot.data.metrics.maxDrawdown ?? 0)}</strong></div><div><span>集中度 HHI</span><strong>{Number(snapshot.data.metrics.concentrationHHI ?? 0).toFixed(3)}</strong></div><div><span>数据时点</span><strong>{shortDate(snapshot.data.dataAsOf)}</strong></div></section> : null}
          {mode === "DECISION_FLOW" ? <section className="decision-flow">
            <div className="option-title"><div><span>STEP 1 / COMPARE</span><h2>下一步候选方案</h2><p>{options.data?.provider === "CHIEF_ADVISOR" ? "Chief Advisor 已组织画像、研究、风险和合规角色。" : "当前候选由确定性 fallback 生成，界面会明确标注，不冒充模型输出。"}</p></div><button className="button primary" onClick={() => void generate()} disabled={Boolean(busy) || ["QUEUED", "RUNNING"].includes(options.data?.status ?? "")}><WandSparkles size={15} />{busy === "generate" ? "正在排队…" : "生成新一轮方案"}</button></div>
            <div className="decision-status">{options.data?.status === "QUEUED" || options.data?.status === "RUNNING" ? <Status tone="warn">{options.data.status === "QUEUED" ? "Agent 已排队" : "Agent 正在分析"}</Status> : options.data?.status === "SUCCEEDED" ? <Status tone="good">候选已就绪</Status> : options.data?.status === "FAILED" ? <Status tone="danger">本轮失败</Status> : <Status>等待生成</Status>}{options.data?.priceManifest?.capturedAt ? <small>冻结价格：{shortDate(options.data.priceManifest.capturedAt)}</small> : null}</div>
            {options.data?.items.length ? <div className="option-grid">{options.data.items.map((option) => <BranchOptionCard key={option.id} option={option} disabled={options.data?.status !== "SUCCEEDED"} busy={busy === option.id} onExecute={() => void execute(option)} />)}</div> : <BranchOptionEmptyState status={options.data?.status ?? "EMPTY"} />}
            <div className="panel decision-result"><div className="panel-heading"><div><span>STEP 2 / VERIFY</span><h2>执行后的组合变化</h2></div><Status tone="good">只写入模拟分支</Status></div><BranchDiff parent={parentSnapshot.data} child={snapshot.data} /></div>
          </section> : <section className="lab-layout">
            <div className="panel"><div className="panel-heading"><div><span>BRANCH TIMELINE</span><h2>决策事件</h2></div></div><BranchEventTimeline events={events} /></div>
            <div className="panel"><div className="panel-heading"><div><span>ASSET DIFF</span><h2>父子分支差异</h2></div></div><BranchDiff parent={parentSnapshot.data} child={snapshot.data} /></div>
            <div className="panel"><div className="panel-heading"><div><span>FROZEN DATA</span><h2>复现实验条件</h2></div></div><dl className="lab-facts"><div><dt>价格清单 SHA-256</dt><dd>{snapshot.data?.priceManifestSha256 ?? "根分支使用原始持仓快照"}</dd></div><div><dt>数据时点</dt><dd>{snapshot.data?.dataAsOf ?? "—"}</dd></div><div><dt>引擎版本</dt><dd>{snapshot.data?.engineVersion ?? "—"}</dd></div><div><dt>工作区版本</dt><dd>{workspace.data.version}</dd></div></dl></div>
          </section>}
        </> : null}
      </div>
    </section>
  </div>;
}
