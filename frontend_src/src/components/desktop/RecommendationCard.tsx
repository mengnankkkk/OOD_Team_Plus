import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Recommendation } from "@/types/app/recommendation";
import { useNavigate } from "react-router-dom";

interface RecommendationCardProps {
  rec: Recommendation | null;
  onGenerate?: () => void;
  generating?: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  decrease: "减配建议",
  increase: "增配建议",
  hold: "维持观察",
  observe: "重点观察",
  emergency_reserve: "补齐应急金",
};

const RecommendationCard = ({ rec, onGenerate, generating }: RecommendationCardProps) => {
  const navigate = useNavigate();

  if (!rec) {
    return (
      <section className="paper-card relative overflow-hidden p-6 md:p-8">
        <p className="eyebrow">今天没有紧要的决定</p>
        <h2 className="mt-3 text-2xl font-semibold">Agent 尚未生成新建议</h2>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">让规划、数据、组合、风险、合规九个 Agent 走一轮流水线，把你目前的画像与账本对照可行动的建议。</p>
        <div className="mt-6"><Button onClick={onGenerate} disabled={generating} className="h-11 px-6"><Sparkles className="size-4" />{generating ? "Agent 正在协作…" : "生成一轮 Multi-Agent 建议"}</Button></div>
      </section>
    );
  }

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
        <Button className="h-11 px-6" onClick={() => navigate(`/recommendations/${rec.id}`)}>模拟采纳 <ArrowRight /></Button>
        <Button variant="outline" className="h-11" onClick={() => navigate(`/recommendations/${rec.id}?tab=evidence`)}>查看证据与反方观点</Button>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" /> {rec.complianceStatus === "approved" ? "风险与合规双重审查已通过" : rec.complianceStatus === "blocked" ? "已被合规节点拦截" : "待复核"}</span>
      </div>
    </section>
  );
};

export default RecommendationCard;
