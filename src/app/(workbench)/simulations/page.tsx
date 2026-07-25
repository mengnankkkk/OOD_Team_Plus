"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, GitBranch, ListTree, Plus, RotateCcw, ShieldCheck, Split, WandSparkles } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BranchDiff } from "@/features/workbench/components/branch-diff";
import { BranchEventTimeline } from "@/features/workbench/components/branch-event-timeline";
import { BranchOptionCard, BranchOptionEmptyState, type BranchOption } from "@/features/workbench/components/branch-option-card";
import { ErrorBlock, LoadingBlock, PageHeading, Status, useApiResource } from "@/features/workbench/components/shared";
import { apiMutation, money, percent, shortDate } from "@/features/workbench/lib/api";
import { simulationProviderMessage } from "@/features/workbench/lib/simulation-provider";

type WorkspaceSummary = { id: string; name: string; objectiveText: string; status: string; activeBranchId: string; version: number; updatedAt: string };
type TimelineEvent = { id?: string; event_type?: string; eventType?: string; created_at?: string; createdAt?: string; payload?: Record<string, unknown> };
type Branch = { id: string; parentBranchId: string | null; label: string; depth: number; status: string };
type ActiveHoldingsPayload = { items: Array<{ id: string; portfolio_id?: string | null; instrument_id?: string | null }> };
type Workspace = { id: string; name: string; objectiveText: string; status: string; portfolioSnapshotId: string; portfolioSource?: "USER_PORTFOLIO" | "STARTER_PORTFOLIO"; rootBranchId: string; activeBranchId: string; branches: Branch[]; events: TimelineEvent[]; version: number };
type Snapshot = { cash: string; totalValue: string; totalAssets?: string; costBasis?: string; unrealizedPnl: string; holdings: Array<{ instrumentId: string; quantity: string; cost?: string | null; marketValue: string; weightBps: number }>; metrics: { expectedReturn?: number; maxDrawdown?: number; concentrationHHI?: number; riskLevel?: string }; dataAsOf: string; priceManifestSha256?: string | null; engineVersion: string };
type OptionsPayload = { batchId: string | null; status: string; items: BranchOption[]; provider?: string | null; fallbackReason?: string | null; priceManifest?: { capturedAt?: string; sha256?: string } | null; analysis?: { analysisId: string; streamUrl: string } | null };
type CreateWorkspaceResponse = { id: string; portfolioSnapshotId: string; portfolioSource: "USER_PORTFOLIO" | "STARTER_PORTFOLIO" };

export default function SimulationsPage() {
  const activeHoldings = useApiResource<ActiveHoldingsPayload>("/api/v1/holdings");
  const list = useApiResource<{ items: WorkspaceSummary[] }>("/api/v1/simulation-workspaces?limit=20");
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"DECISION_FLOW" | "LAB">("DECISION_FLOW");
  const [label, setLabel] = useState("我的第一次分支模拟");
  const [objective, setObjective] = useState("看看不同买卖方案对我的组合有什么影响");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const createFormRef = useRef<HTMLFormElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const hasAutoSelectedWorkspaceRef = useRef(false);
  const selectedWorkspaceRef = useRef("");

  const workspace = useApiResource<Workspace>(selected ? `/api/v1/simulation-workspaces/${selected}` : null);
  const options = useApiResource<OptionsPayload>(selected ? `/api/v1/simulation-workspaces/${selected}/options` : null);
  const activeBranch = workspace.data?.branches.find((branch) => branch.id === workspace.data?.activeBranchId);
  const parentBranchId = activeBranch?.parentBranchId ?? null;
  const snapshot = useApiResource<Snapshot>(workspace.data ? `/api/v1/simulation-workspaces/${workspace.data.id}/branches/${workspace.data.activeBranchId}/snapshot` : null);
  const parentSnapshot = useApiResource<Snapshot>(workspace.data && parentBranchId ? `/api/v1/simulation-workspaces/${workspace.data.id}/branches/${parentBranchId}/snapshot` : null);
  const events = useMemo(() => workspace.data?.events ?? [], [workspace.data?.events]);
  const reloadOptions = options.reload;
  const setWorkspaceData = workspace.setData;
  const setOptionsData = options.setData;
  const setSnapshotData = snapshot.setData;
  const setParentSnapshotData = parentSnapshot.setData;
  const hasRealHoldings = Boolean(activeHoldings.data?.items.length);
  const starterMode = !activeHoldings.loading && !hasRealHoldings;
  const selectWorkspace = useCallback((workspaceId: string) => {
    selectedWorkspaceRef.current = workspaceId;
    setWorkspaceData(null);
    setOptionsData(null);
    setSnapshotData(null);
    setParentSnapshotData(null);
    setSelected(workspaceId);
  }, [setOptionsData, setParentSnapshotData, setSnapshotData, setWorkspaceData]);

  useEffect(() => {
    if (hasAutoSelectedWorkspaceRef.current || !list.data) return;
    hasAutoSelectedWorkspaceRef.current = true;
    const requestedWorkspaceId = new URLSearchParams(window.location.search).get("workspace")?.trim() ?? "";
    if (requestedWorkspaceId) selectWorkspace(requestedWorkspaceId);
    else if (list.data.items[0]) selectWorkspace(list.data.items[0].id);
  }, [list.data, selectWorkspace]);

  useEffect(() => {
    if (!["QUEUED", "RUNNING"].includes(options.data?.status ?? "")) return;
    const timer = setInterval(() => { void reloadOptions(); }, 1000);
    return () => clearInterval(timer);
  }, [options.data?.status, reloadOptions]);

  const queueOptions = async (workspaceId: string, objectiveText = objective) => {
    const queued = await apiMutation<OptionsPayload>(`/api/v1/simulation-workspaces/${workspaceId}/options`, "POST", { objective: objectiveText });
    if (selectedWorkspaceRef.current === workspaceId) setOptionsData(queued);
  };

  const startNewWorkspace = () => {
    selectWorkspace("");
    setMode("DECISION_FLOW");
    setError("");
    setLabel(hasRealHoldings ? "我的持仓分支模拟" : "我的第一次分支模拟");
    requestAnimationFrame(() => {
      createFormRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      labelInputRef.current?.focus();
    });
  };

  const selectMode = (nextMode: typeof mode) => {
    setMode(nextMode);
    requestAnimationFrame(() => {
      document.getElementById("simulation-main")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  const createWorkspace = async (event?: FormEvent) => {
    event?.preventDefault();
    if (activeHoldings.loading) return;
    setBusy("create"); setError("");
    try {
      const data = await apiMutation<CreateWorkspaceResponse>("/api/v1/simulation-workspaces", "POST", {
        label,
        objectiveText: objective,
      });
      selectWorkspace(data.id);
      await list.reload();
      try {
        await queueOptions(data.id);
      } catch (reason) {
        setError(`工作区已创建，但方案生成没有启动：${reason instanceof Error ? reason.message : "请点击“生成新一轮方案”重试"}`);
      }
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
      await queueOptions(workspace.data.id, workspace.data.objectiveText);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成失败");
    } finally {
      setBusy("");
    }
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

  if ((list.loading && !list.data) || (activeHoldings.loading && !activeHoldings.data)) return <LoadingBlock label="正在装载分支实验室" />;
  return <div className="page-stack simulation-page">
    <PageHeading
      eyebrow="SCENARIO BRANCH LAB / 分支实验室"
      title="先看看不同选择，再决定怎么做"
      description="这是一个不会下单的练习场。你可以先用示例组合体验，也可以直接连接自己的持仓。"
      actions={<><button type="button" className={`button ${mode === "DECISION_FLOW" ? "primary" : "ghost"}`} aria-pressed={mode === "DECISION_FLOW"} onClick={() => selectMode("DECISION_FLOW")}><ListTree size={15} />决策流</button><button type="button" className={`button ${mode === "LAB" ? "primary" : "ghost"}`} aria-pressed={mode === "LAB"} onClick={() => selectMode("LAB")}><GitBranch size={15} />分支实验室</button>{selected && workspace.data && workspace.data.activeBranchId !== workspace.data.rootBranchId ? <button type="button" className="button ghost" onClick={() => void undo()} disabled={Boolean(busy)}><RotateCcw size={15} />撤回</button> : null}</>}
    />
    {error ? <ErrorBlock message={error} /> : null}
    <section className="simulation-layout">
      <aside className="panel workspace-sidebar">
        <div className="panel-heading"><div><span>WORKSPACES / 你的练习</span><h2>实验工作区</h2></div><button type="button" className="icon-button" aria-label="新建实验工作区" title="新建实验工作区" onClick={startNewWorkspace} disabled={Boolean(busy)}><Plus size={17} /></button></div>
        <div className="workspace-list">{list.data?.items.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => selectWorkspace(item.id)} disabled={Boolean(busy)}><GitBranch size={16} /><span><b>{item.name}</b><small>{shortDate(item.updatedAt)}</small></span><Status tone={item.status === "ACTIVE" ? "good" : "neutral"}>{item.status}</Status></button>)}</div>
        <div className={`portfolio-readiness ${starterMode ? "starter" : "ready"}`}>
          <div className="portfolio-readiness-head">{starterMode ? <WandSparkles size={15} /> : <CheckCircle2 size={15} />}<strong>{starterMode ? "还没有录入持仓" : "已连接你的持仓"}</strong></div>
          <p>{starterMode ? "可以先用一份真实标的示例组合体验。它只存在于模拟里，不会写入你的账本。" : `已检测到 ${activeHoldings.data?.items.length ?? 0} 笔真实持仓，新建实验会优先使用你的持仓，真实资产不会被改写。`}</p>
          {starterMode ? <Link className="text-link" href="/assets">去录入我的持仓 <ArrowRight size={13} /></Link> : null}
        </div>
        <form ref={createFormRef} className="create-workspace" onSubmit={(event) => void createWorkspace(event)}>
          <label>新实验名称<input ref={labelInputRef} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label>你想先看看什么？<textarea rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="例如：如果我减一点科技股，组合会怎样？" /></label>
          <button className="button primary" disabled={busy === "create"}>{busy === "create" ? "正在准备方案…" : starterMode ? <><WandSparkles size={15} />用示例组合开始</> : <><Plus size={15} />用我的持仓开始</>}</button>
          <small className="form-hint">创建后会自动生成 A / B / C 三个可比较方案。</small>
        </form>
      </aside>
      <div className="simulation-main" id="simulation-main">
        {!selected ? <section className="panel simulation-welcome">
          <div className="simulation-welcome-copy"><Status tone="good"><ShieldCheck size={12} />只做模拟，不会下单</Status>{mode === "DECISION_FLOW" ? <><h2>用 1 分钟体验一次“如果我这样买，会发生什么？”</h2><p>先创建一个练习工作区，Agent 会自动给你 3 个方案：保持不动、谨慎调整、积极调整。你可以执行其中任意一个，随时切换或撤回。</p></> : <><h2>分支实验室会记录每一次选择</h2><p>创建并执行方案后，这里会显示分支树、父子资产差异、撤回记录和冻结数据条件。先从左侧创建一个工作区即可进入实验室。</p></>}</div>
          <div className="simulation-steps"><div><b>1</b><span>准备组合</span><small>{starterMode ? "先用示例组合即可" : "将使用你的真实持仓"}</small></div><div><b>2</b><span>比较 A / B / C</span><small>看风险和资产变化</small></div><div><b>3</b><span>执行模拟</span><small>只改变分支，不改真账</small></div></div>
          <div className="simulation-welcome-actions"><button className="button primary" onClick={() => void createWorkspace()} disabled={Boolean(busy)}><WandSparkles size={15} />{busy === "create" ? "正在准备…" : starterMode ? "用示例组合开始" : "用我的持仓开始"}</button>{starterMode ? <Link className="button ghost" href="/assets">我有持仓，先去录入 <ArrowRight size={14} /></Link> : null}</div>
        </section> : workspace.loading && !workspace.data ? <LoadingBlock /> : workspace.error && !workspace.data ? <ErrorBlock message={workspace.error} retry={workspace.reload} /> : workspace.data ? <>
          <section className="panel branch-map">
            <div className="panel-heading"><div><span>ACTIVE SCENARIO / 当前练习</span><h2>{workspace.data.name}</h2><p>{workspace.data.objectiveText}</p></div><div className="scenario-badges"><Status tone="good"><ShieldCheck size={12} />只做模拟</Status>{workspace.data.portfolioSource === "STARTER_PORTFOLIO" ? <Status tone="warn">示例组合</Status> : <Status tone="good">我的持仓</Status>}</div></div>
            {workspace.data.portfolioSource === "STARTER_PORTFOLIO" ? <div className="inline-notice starter-notice">当前使用的是 AAPL、MSFT、SPY、GLD 示例组合。它只用于体验分支模拟，不会改动你的真实账本。录入自己的持仓后，可以重新创建一个“我的持仓”实验。</div> : null}
            <div className="branch-tree">{workspace.data.branches.map((branch) => <button key={branch.id} style={{ marginLeft: `${branch.depth * 30}px` }} className={branch.id === workspace.data?.activeBranchId ? "active" : ""} onClick={() => void switchBranch(branch.id)} disabled={Boolean(busy)}><span className="branch-line" /><Split size={16} /><span><b>{branch.label}</b><small>深度 {branch.depth} · {branch.id.slice(-6)}</small></span>{branch.id === workspace.data?.activeBranchId ? <Status tone="good">当前</Status> : null}</button>)}</div>
          </section>
          {snapshot.data ? <section className="branch-summary"><div><span>模拟总资产</span><strong>{money(Number(snapshot.data.totalAssets ?? Number(snapshot.data.cash) + Number(snapshot.data.totalValue)))}</strong></div><div><span>浮盈亏</span><strong className={Number(snapshot.data.unrealizedPnl) >= 0 ? "positive" : "negative"}>{money(snapshot.data.unrealizedPnl)}</strong></div><div><span>压力回撤</span><strong className="negative">{percent(snapshot.data.metrics.maxDrawdown ?? 0)}</strong></div><div><span>集中度 HHI</span><strong>{Number(snapshot.data.metrics.concentrationHHI ?? 0).toFixed(3)}</strong></div><div><span>数据时点</span><strong>{shortDate(snapshot.data.dataAsOf)}</strong></div></section> : null}
          {mode === "DECISION_FLOW" ? <section className="decision-flow">
            <div className="option-title"><div><span>STEP 1 / COMPARE</span><h2>下一步候选方案</h2><p>{simulationProviderMessage(options.data?.status, options.data?.provider, options.data?.fallbackReason)}</p></div><button className="button primary" onClick={() => void generate()} disabled={Boolean(busy) || ["QUEUED", "RUNNING"].includes(options.data?.status ?? "")}><WandSparkles size={15} />{busy === "generate" ? "正在排队…" : "生成新一轮方案"}</button></div>
            <div className="decision-status">{options.data?.status === "QUEUED" || options.data?.status === "RUNNING" ? <Status tone="warn">{options.data.status === "QUEUED" ? "Agent 已排队" : "Agent 正在分析"}</Status> : options.data?.status === "SUCCEEDED" ? <Status tone="good">候选已就绪</Status> : options.data?.status === "FAILED" ? <Status tone="danger">本轮失败</Status> : <Status>等待生成</Status>}{options.data?.priceManifest?.capturedAt ? <small>冻结价格：{shortDate(options.data.priceManifest.capturedAt)}</small> : null}</div>
            {options.data?.items.length ? <div className="option-grid">{options.data.items.map((option) => <BranchOptionCard key={option.id} option={option} disabled={options.data?.status !== "SUCCEEDED"} busy={busy === option.id} onExecute={() => void execute(option)} />)}</div> : <BranchOptionEmptyState status={options.data?.status ?? "EMPTY"} />}
            <div className="panel decision-result"><div className="panel-heading"><div><span>STEP 2 / VERIFY</span><h2>执行后的组合变化</h2></div><Status tone="good">只写入模拟分支</Status></div><BranchDiff parent={parentSnapshot.data} child={snapshot.data} /></div>
          </section>
          : <section className="lab-layout">
            <div className="panel"><div className="panel-heading"><div><span>BRANCH TIMELINE</span><h2>决策事件</h2></div></div><BranchEventTimeline events={events} /></div>
            <div className="panel"><div className="panel-heading"><div><span>ASSET DIFF</span><h2>父子分支差异</h2></div></div><BranchDiff parent={parentSnapshot.data} child={snapshot.data} /></div>
            <div className="panel"><div className="panel-heading"><div><span>FROZEN DATA</span><h2>复现实验条件</h2></div></div><dl className="lab-facts"><div><dt>价格清单 SHA-256</dt><dd>{snapshot.data?.priceManifestSha256 ?? "根分支使用原始持仓快照"}</dd></div><div><dt>数据时点</dt><dd>{snapshot.data?.dataAsOf ?? "—"}</dd></div><div><dt>引擎版本</dt><dd>{snapshot.data?.engineVersion ?? "—"}</dd></div><div><dt>工作区版本</dt><dd>{workspace.data.version}</dd></div></dl></div>
          </section>}
        </> : null}
      </div>
    </section>
  </div>;
}
