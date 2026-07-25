import { ArrowRight, CircleAlert, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Recommendation } from "@/types/app/recommendation";
import { useNavigate } from "@/features/frontend-migration/router";
import AnimatedMenuButton from "@/components/desktop/AnimatedMenuButton";

interface RecommendationCardProps {
  rec: Recommendation | null;
  onGenerate?: () => void;
  generating?: boolean;
  generationStatus?: string | null;
  hasHoldings?: boolean;
  profileReady?: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  decrease: "减配建议",
  increase: "增配建议",
  hold: "维持观察",
  observe: "重点观察",
  emergency_reserve: "补齐应急金",
};

const RecommendationCard = ({
  rec,
  onGenerate,
  generating = false,
  generationStatus,
  hasHoldings = true,
  profileReady = true,
}: RecommendationCardProps) => {
  const navigate = useNavigate();
  const setupMessage = !profileReady
    ? "生成前需要先完成投资画像"
    : !hasHoldings
      ? "生成前需要先录入至少一笔真实持仓"
      : null;

  if (!rec) {
    return (
      <section className="recommendation-card paper-card relative overflow-hidden p-6 md:p-8">
        <p className="eyebrow">今天没有紧要的决定</p>
        <h2 className="mt-3 text-2xl font-semibold">Agent 尚未生成今日组合建议</h2>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">让画像、数据研究、组合风险、建议、合规等专业 Agent 完成一轮协作，把你目前的画像与账本对照成可行动的建议。</p>
        {setupMessage ? (
          <div className="mt-5 flex items-center gap-2 border border-foreground/30 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <CircleAlert className="size-4 shrink-0 text-primary" />
            {setupMessage}
          </div>
        ) : null}
        <div className="mt-7 flex flex-wrap items-center gap-4 border-t border-border pt-6">
          <AnimatedMenuButton
            onClick={onGenerate}
            disabled={generating}
            icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          >
            {generating ? "正在生成今日建议" : "生成今日组合建议"}
          </AnimatedMenuButton>
          <p className="max-w-xl text-xs leading-5 text-muted-foreground" aria-live="polite">
            {generating
              ? generationStatus ?? "Chief Advisor 正在调度专业 Agent"
              : setupMessage ?? "预计需要一点时间，生成后会自动刷新这里；不会创建真实订单。"}
          </p>
        </div>
      </section>
    );
  }
  const blocked = rec.status === "blocked" || rec.complianceStatus === "blocked";

  return (
    <section className="recommendation-card paper-card relative overflow-hidden p-6 md:p-8">
      <div className="absolute right-5 top-5 rounded border border-destructive/30 px-2 py-1 font-mono text-[10px] text-destructive">No.{rec.id.slice(0, 8).toUpperCase()}</div>
      <p className="eyebrow text-destructive">{ACTION_LABEL[rec.action] ?? "建议"} · 今天需要你决定的事情</p>
      <h2 className="mt-3 max-w-2xl text-2xl font-semibold">{rec.headline}</h2>
      <div className="mt-7 grid gap-5 text-sm md:grid-cols-3">
        <div><p className="text-muted-foreground">动因</p><p className="mt-1 font-medium">{rec.driver}</p></div>
        <div><p className="text-muted-foreground">建议节奏</p><p className="mt-1 font-medium">{rec.pace ?? "由用户自定"}</p></div>
        <div><p className="text-muted-foreground">有效期至</p><p className="mt-1 font-medium">{rec.effectiveUntil}</p></div>
      </div>
      <div className="mt-4 border border-foreground bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        失效条件：{rec.expireCondition}
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button className="h-11 px-6" onClick={() => navigate(`/recommendations/${rec.id}${blocked ? "?tab=lab" : ""}`)}>{blocked ? "查看阻断原因" : "模拟采纳"} <ArrowRight /></Button>
        <Button variant="outline" className="h-11" onClick={() => navigate(`/recommendations/${rec.id}?tab=evidence`)}>查看证据与反方观点</Button>
        <AnimatedMenuButton
          className="h-11"
          onClick={onGenerate}
          disabled={generating}
          icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        >
          {generating ? "正在更新" : "更新今日建议"}
        </AnimatedMenuButton>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" /> {rec.complianceStatus === "approved" ? "风险与合规双重审查已通过" : rec.complianceStatus === "blocked" ? "已被合规节点拦截" : "待复核"}</span>
      </div>
      {generating ? <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">{generationStatus ?? "Chief Advisor 正在调度专业 Agent"}</p> : null}
    </section>
  );
};

export default RecommendationCard;
