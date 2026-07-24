import { useMemo, useState } from "react";
import AllocationPanel from "@/components/desktop/AllocationPanel";
import DrawdownChart from "@/components/desktop/DrawdownChart";
import GoalProgress from "@/components/desktop/GoalProgress";
import HealthMetrics from "@/components/desktop/HealthMetrics";
import RecommendationCard from "@/components/desktop/RecommendationCard";
import { useApiResource } from "@/features/workbench/components/shared";
import { useAuth } from "@/hooks/useAuth";
import { useUserGoals } from "@/hooks/useUserGoals";
import { useHoldings } from "@/hooks/useHoldings";
import { useAgentRuns, useRecommendationInvalidator, useRecommendations } from "@/hooks/useRecommendations";
import { computeHealthMetrics } from "@/lib/financialHealth";
import { runAgentWorkflow } from "@/services/recommendationService";
import { toast } from "sonner";
import AnimatedMenuButton from "@/components/desktop/AnimatedMenuButton";
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Rss, Sparkles } from "lucide-react";
import { useDemoMode } from "@/hooks/useDemoMode";

const todayStamp = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

type RssItem = {
  id: string;
  feedName: string;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  publishedAt: string | null;
  categories: string[];
};

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
    <div className="newsprint-texture home-black-buttons">
      <div className="newsprint-masthead mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="newsprint-date-line">{todayStamp} · 数据更新至上一交易日 · MONEY WHISPERER DAILY</p>
          <h1 className="newsprint-headline mt-4 max-w-5xl text-4xl sm:text-5xl lg:text-5xl">你好，{displayName}。先看目标，再看市场。</h1>
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
      <HomeRssCard />
    </div>
  );
};

const HomeRssCard = () => {
  const rss = useApiResource<{ items: RssItem[] }>("/api/v1/rss/items?limit=5");
  const items = rss.data?.items ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const active = items.length ? Math.min(activeIndex, items.length - 1) : 0;
  const move = (direction: -1 | 1) => {
    if (!items.length) return;
    setActiveIndex((index) => (index + direction + items.length) % items.length);
  };

  return (
    <section className="paper-card mt-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Rss className="size-4 text-primary" />
            <p className="eyebrow">RSS 阅读</p>
          </div>
          <h2 className="mt-2 text-2xl font-semibold">市场资讯流</h2>
          <p className="mt-1 text-sm text-muted-foreground">首页快速扫一眼已审核来源，完整阅读仍保留在 RSS 页面。</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="button ghost" onClick={() => void rss.reload()} disabled={rss.loading}>
            <RefreshCw className={`size-4 ${rss.loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <a className="button ghost" href="/rss">查看全部</a>
        </div>
      </div>

      {rss.error ? <div className="mt-4 rounded-md border border-destructive/30 p-3 text-sm text-destructive">{rss.error}</div> : null}
      {rss.loading ? <p className="mt-5 text-sm text-muted-foreground">正在读取资讯源…</p> : null}
      {!rss.loading && !rss.error && items.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">当前还没有 RSS 资讯。</p> : null}
      {items.length ? (
        <div className="rss-carousel" aria-roledescription="carousel" aria-label="RSS 资讯轮播">
          <div className="rss-carousel-stage">
            {items.map((item, index) => {
              let offset = index - active;
              if (offset > items.length / 2) offset -= items.length;
              if (offset < -items.length / 2) offset += items.length;
              const distance = Math.min(Math.abs(offset), 2);
              const isActive = offset === 0;
              const hidden = Math.abs(offset) > 2;
              return (
                <article
                  key={item.id}
                  className="rss-slide"
                  data-active={isActive}
                  aria-current={isActive}
                  aria-hidden={hidden}
                  role="button"
                  tabIndex={hidden ? -1 : 0}
                  onClick={() => setActiveIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveIndex(index);
                    }
                  }}
                  style={{
                    transform: `translateX(-50%) translateX(${offset * 62}%) scale(${isActive ? 1 : distance === 1 ? 0.86 : 0.72}) rotateY(${offset * -7}deg)`,
                    opacity: hidden ? 0 : isActive ? 1 : distance === 1 ? 0.68 : 0.32,
                    zIndex: 10 - distance,
                  }}
                >
                  <div className="rss-slide-visual">
                    <Rss className="size-7" />
                    <span>{item.feedName}</span>
                  </div>
                  <div className="rss-slide-body">
                    <div className="flex items-start justify-between gap-3">
                      <small>{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "未标注日期"}</small>
                      <a href={item.canonicalUrl} target="_blank" rel="noreferrer" aria-label={`打开${item.title}`} className="rss-slide-link" onClick={(event) => event.stopPropagation()}>
                        <ExternalLink className="size-4" />
                      </a>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.summary ?? "该条目未提供摘要。"}</p>
                    <div className="rss-slide-tags">
                      {item.categories.slice(0, 2).map((category) => <span key={category}>{category}</span>)}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {items.length > 1 ? (
            <div className="rss-carousel-controls">
              <button type="button" aria-label="上一条资讯" onClick={() => move(-1)}><ChevronLeft className="size-4" /></button>
              <div className="rss-carousel-dots">{items.map((item, index) => <button key={item.id} type="button" aria-label={`切换到第 ${index + 1} 条资讯`} aria-current={index === active} onClick={() => setActiveIndex(index)} />)}</div>
              <button type="button" aria-label="下一条资讯" onClick={() => move(1)}><ChevronRight className="size-4" /></button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default HomePage;
