import { useMemo, useState } from "react";
import AllocationPanel from "@/components/desktop/AllocationPanel";
import AgentTheater from "@/components/desktop/AgentTheater";
import DrawdownChart from "@/components/desktop/DrawdownChart";
import GoalProgress from "@/components/desktop/GoalProgress";
import HealthMetrics from "@/components/desktop/HealthMetrics";
import RecommendationCard from "@/components/desktop/RecommendationCard";
import { useAuth } from "@/hooks/useAuth";
import { useUserGoals } from "@/hooks/useUserGoals";
import { useHoldings } from "@/hooks/useHoldings";
import { useAgentRuns, useRecommendationInvalidator, useRecommendations } from "@/hooks/useRecommendations";
import { computeHealthMetrics } from "@/lib/financialHealth";
import { runAgentWorkflow } from "@/services/recommendationService";
import { toast } from "sonner";
import AnimatedMenuButton from "@/components/desktop/AnimatedMenuButton";
import { Sparkles } from "lucide-react";
import { useDemoMode } from "@/hooks/useDemoMode";

const todayStamp = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

const HomePage = () => {
  const { profile } = useAuth();
  const { judgeMode } = useDemoMode();
  const { data: goals, isLoading: goalsLoading } = useUserGoals();
  const { data: holdings = [], isLoading: holdingsLoading } = useHoldings();
  const { data: recommendations = [] } = useRecommendations();
  const { data: agentRuns = [] } = useAgentRuns(1);
  const invalidateRecs = useRecommendationInvalidator();
  const [generating, setGenerating] = useState(false);

  const primaryGoal = goals?.[0] ?? null;
  const displayName = profile?.displayName || "同学";
  const metrics = useMemo(() => computeHealthMetrics(holdings, profile, goals ?? []), [holdings, profile, goals]);
  const activeRec = recommendations.find((r) => r.status === "active") ?? recommendations[0] ?? null;
  const latestRun = agentRuns[0] ?? null;

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await runAgentWorkflow("home_manual");
      if (result.recommendations?.length) toast.success(`Agent 生成 ${result.recommendations.length} 条建议`);
      else if (result.signals?.length) toast.info("Agent 未触发建议阈值，请关注信号面板");
      else toast.info("目前一切平稳，未触发建议");
      invalidateRecs();
    } catch (err: any) {
      toast.error(err?.message ?? "Agent 工作流失败");
    } finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{todayStamp} · 数据更新至上一交易日</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">你好，{displayName}。先看目标，再看市场。</h1>
        </div>
        <div className="flex items-center gap-3">
          {judgeMode && <span className="judge-note">评委批注已开启 · 完整证据链可见</span>}
          <AnimatedMenuButton onClick={handleGenerate} disabled={generating} icon={<Sparkles className="size-4" />}>{generating ? "Agent 运行中…" : "运行一轮 Agent 建议"}</AnimatedMenuButton>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <GoalProgress goal={primaryGoal} loading={goalsLoading} />
        <HealthMetrics metrics={holdings.length ? metrics : null} profile={profile} loading={holdingsLoading} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AllocationPanel metrics={holdings.length ? metrics : null} loading={holdingsLoading} />
        <DrawdownChart metrics={holdings.length ? metrics : null} loading={holdingsLoading} />
      </div>

      {judgeMode && latestRun && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="text-xs uppercase text-destructive">评委批注 · 最近一次 Agent 运行</p>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">Agent 数</p><p className="font-mono">{Object.keys(latestRun.agentStates ?? {}).length} 个</p></div>
            <div><p className="text-xs text-muted-foreground">总耗时</p><p className="font-mono">{Object.values(latestRun.agentStates ?? {}).reduce((s: number, x: any) => s + (x?.durationMs ?? 0), 0)} ms</p></div>
            <div><p className="text-xs text-muted-foreground">规划概要</p><p className="line-clamp-2">{latestRun.plannerSummary}</p></div>
          </div>
        </div>
      )}

      <div className="mt-6"><RecommendationCard rec={activeRec} onGenerate={handleGenerate} generating={generating} /></div>
      <AgentTheater latestRun={latestRun} generating={generating} />
    </div>
  );
};

export default HomePage;
