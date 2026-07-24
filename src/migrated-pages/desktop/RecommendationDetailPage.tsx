import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "@/features/frontend-migration/router";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { getEvidenceForRecommendation, getRecommendation, updateRecommendationStatus } from "@/services/recommendationService";
import type { EvidencePack, Recommendation } from "@/types/app/recommendation";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle, ShieldCheck, XCircle } from "lucide-react";
import EvidenceLab from "@/components/desktop/EvidenceLab";
import SimulationCompare from "@/components/desktop/SimulationCompare";
import OutcomeCompare from "@/components/desktop/OutcomeCompare";
import { useRecommendationInvalidator } from "@/hooks/useRecommendations";
import { apiPost } from "@/features/frontend-migration/api";

const ACTION_LABEL: Record<string, string> = {
  decrease: "减配",
  increase: "增配",
  hold: "持有",
  observe: "观察",
  emergency_reserve: "应急金",
};

const RecommendationDetailPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "overview";
  const navigate = useNavigate();
  const { user } = useAuth();
  const invalidate = useRecommendationInvalidator();
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [evidence, setEvidence] = useState<EvidencePack | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"adopt" | "reject" | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    setLoading(true);
    Promise.all([getRecommendation(user.id, id), getEvidenceForRecommendation(user.id, id)])
      .then(([r, e]) => { setRec(r); setEvidence(e); })
      .catch((err) => toast.error(err?.message ?? "读取失败"))
      .finally(() => setLoading(false));
  }, [user, id]);

  const handleAdopt = async () => {
    if (!user || !rec) return;
    setBusy("adopt");
    try {
      await apiPost(`/api/v1/recommendations/${rec.id}/simulations`, { label: rec.headline, objective: "模拟采纳建议对当前组合的影响" });
      await updateRecommendationStatus(user.id, rec.id, "simulated");
      toast.success("已落章 · 模拟采纳记录已写入");
      invalidate();
      const fresh = await getRecommendation(user.id, rec.id);
      if (fresh) setRec(fresh);
    } catch (err: any) {
      toast.error(err?.message ?? "模拟采纳失败");
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (!user || !rec) return;
    const reason = prompt("为什么拒绝这条建议？（可选）") ?? null;
    setBusy("reject");
    try {
      await updateRecommendationStatus(user.id, rec.id, "rejected");
      toast.success("已拒绝并写入决策日志");
      invalidate();
      navigate("/");
    } catch (err: any) {
      toast.error(err?.message ?? "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async () => {
    if (!user || !rec) return;
    if (!confirm("撤销这枚模拟采纳章吗？")) return;
    try {
      await updateRecommendationStatus(user.id, rec.id, "active");
      toast.success("模拟采纳已撤销");
      invalidate();
      const fresh = await getRecommendation(user.id, rec.id);
      if (fresh) setRec(fresh);
    } catch (err: any) {
      toast.error(err?.message ?? "撤销失败");
    }
  };

  const before = useMemo(() => (evidence?.simulationLog?.[0] as any) ?? null, [evidence]);
  const after = useMemo(() => (evidence?.simulationLog?.[1] as any) ?? null, [evidence]);

  if (loading) return <div className="grid min-h-[50vh] place-items-center text-muted-foreground">正在读取建议详情…</div>;
  if (!rec) return <div className="grid min-h-[50vh] place-items-center text-muted-foreground">未找到该建议</div>;

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" /> 返回</button>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <article className="paper-card relative overflow-hidden p-8">
          {rec.status === "simulated" && <div className="absolute right-8 top-8 rotate-6 rounded border-4 border-destructive/70 px-4 py-2 font-serif text-lg font-bold text-destructive/80">已模拟采纳<div className="text-[10px] font-mono">仅供研究</div></div>}
          <p className="eyebrow">{ACTION_LABEL[rec.action]}建议报告单 · No.{rec.id.slice(0, 8).toUpperCase()}</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-snug">{rec.headline}</h1>

          <dl className="mt-8 grid gap-x-8 gap-y-4 text-sm md:grid-cols-2">
            <div className="border-l-2 border-destructive/40 pl-4"><dt className="text-xs uppercase text-muted-foreground">动因</dt><dd className="mt-1 font-medium">{rec.driver}</dd></div>
            <div className="border-l-2 border-primary/40 pl-4"><dt className="text-xs uppercase text-muted-foreground">建议节奏</dt><dd className="mt-1 font-medium">{rec.pace}</dd></div>
            <div className="border-l-2 border-[hsl(var(--status-watch))]/40 pl-4"><dt className="text-xs uppercase text-muted-foreground">有效期至</dt><dd className="mt-1 font-medium">{rec.effectiveUntil}</dd></div>
            <div className="border-l-2 border-muted-foreground/40 pl-4"><dt className="text-xs uppercase text-muted-foreground">失效条件</dt><dd className="mt-1 text-sm text-muted-foreground">{rec.expireCondition}</dd></div>
          </dl>

          <Tabs defaultValue={initialTab} className="mt-8">
            <TabsList>
              <TabsTrigger value="overview">概览</TabsTrigger>
              <TabsTrigger value="evidence">证据与反方</TabsTrigger>
              <TabsTrigger value="simulate">模拟结果</TabsTrigger>
              <TabsTrigger value="lab">Evidence Lab</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              <p className="text-sm leading-6 text-muted-foreground">这条建议基于你的画像与账本实时生成，绑定的目标是<strong className="text-foreground">{primaryGoalName(rec)}</strong>。风险与合规两个 Agent 已完成独立复核，你可以先模拟采纳，随时撤销。</p>
              <div className="mt-6 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
                <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-primary" /> 风险 & 合规审查</div>
                <p className="mt-1 text-xs text-muted-foreground">{rec.complianceStatus === "approved" ? "两个独立节点均通过审查" : rec.complianceStatus === "blocked" ? "合规节点已拦截，建议维持观察" : "复核中"}</p>
              </div>
            </TabsContent>

            <TabsContent value="evidence" className="space-y-4 pt-4">
              <section>
                <p className="eyebrow">支持证据</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {rec.evidence.map((e, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-border pb-2"><span>{e.label}<span className="ml-2 text-xs text-muted-foreground">来源 {e.source}</span></span><span className="font-mono text-foreground">{e.value}</span></li>
                  ))}
                </ul>
              </section>
              <section>
                <p className="eyebrow text-[hsl(var(--status-watch))]">反方观点</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {rec.counterEvidence.map((e, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-border pb-2"><span>{e.label}<span className="ml-2 text-xs text-muted-foreground">来源 {e.source}</span></span><span className="text-muted-foreground">{e.value}</span></li>
                  ))}
                </ul>
              </section>
            </TabsContent>

            <TabsContent value="simulate" className="space-y-6 pt-4">
              <div><p className="eyebrow">采纳后预期变化</p><div className="mt-3"><SimulationCompare before={before} after={after} action={rec.action} /></div></div>
              <div><p className="eyebrow">采纳 / 不操作 / 替代方案 三种结果对比</p><div className="mt-3"><OutcomeCompare before={before} after={after} rec={rec} /></div></div>
            </TabsContent>

            <TabsContent value="lab" className="pt-4">
              <EvidenceLab evidence={evidence} />
            </TabsContent>
          </Tabs>
        </article>

        <aside className="space-y-4">
          <section className="paper-card p-6">
            <p className="eyebrow">下一步动作</p>
            <div className="mt-4 space-y-3">
              {rec.status === "active" ? (
                <>
                  <Button className="h-12 w-full rounded-sm text-base" onClick={handleAdopt} disabled={busy !== null}><CheckCircle className="size-4" />{busy === "adopt" ? "落章中…" : "模拟采纳 · 落朱砂章"}</Button>
                  <Button variant="outline" className="h-11 w-full rounded-sm" onClick={handleReject} disabled={busy !== null}><XCircle className="size-4" />拒绝并记录原因</Button>
                </>
              ) : rec.status === "simulated" ? (
                <>
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">已落章为模拟采纳，可随时撤销</div>
                  <Button variant="outline" className="h-11 w-full rounded-sm" onClick={handleRevoke}>撤销这枚章</Button>
                </>
              ) : rec.status === "rejected" ? (
                <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">此建议已拒绝，可在决策日志中回看</div>
              ) : null}
            </div>
          </section>

          <section className="paper-card p-6 text-xs text-muted-foreground">
            <p className="eyebrow text-primary">这份印章的边界</p>
            <ul className="mt-3 space-y-2 leading-5">
              <li>· 仅代表你在演示账本上采纳，不接真实交易系统</li>
              <li>· 采纳/撤销/拒绝都写入决策日志，一个月后可完整回放</li>
              <li>· 达到失效日期或失效条件时会自动过期</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
};

function primaryGoalName(rec: Recommendation) {
  return rec.goalId ? "你的首要目标" : "尚未关联具体目标";
}

export default RecommendationDetailPage;
