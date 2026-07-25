import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ClipboardList,
  FileText,
  FlaskConical,
  GitBranch,
  LoaderCircle,
  MessageCircleQuestion,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import EvidenceLab from "@/components/desktop/EvidenceLab";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/features/frontend-migration/api";
import { useNavigate, useSearchParams } from "@/features/frontend-migration/router";
import { useAuth } from "@/hooks/useAuth";
import { useAgentRuns } from "@/hooks/useRecommendations";
import { getEvidenceForAnalysis } from "@/services/recommendationService";
import type { AgentRun, EvidencePack } from "@/types/app/recommendation";

const EvidenceLabPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedAnalysisId = searchParams.get("analysisId");
  const runsQuery = useAgentRuns(50);
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(requestedAnalysisId);
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const [packError, setPackError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!runs.length) return;
    const requested = requestedAnalysisId && runs.some((run) => run.id === requestedAnalysisId) ? requestedAnalysisId : null;
    const current = selectedRunId && runs.some((run) => run.id === selectedRunId) ? selectedRunId : null;
    const next = requested ?? current ?? runs[0].id;
    if (next !== selectedRunId) setSelectedRunId(next);
  }, [requestedAnalysisId, runs, selectedRunId]);

  useEffect(() => {
    if (!user || !selectedRunId) {
      setPack(null);
      return;
    }
    const requestId = ++requestRef.current;
    setLoadingPack(true);
    setPackError("");
    getEvidenceForAnalysis(selectedRunId)
      .then((next) => {
        if (requestRef.current !== requestId) return;
        if (!next) throw new Error("该运行没有可读取的证据包");
        setPack(next);
      })
      .catch((error) => {
        if (requestRef.current !== requestId) return;
        setPack(null);
        setPackError(error instanceof Error ? error.message : "证据包读取失败");
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoadingPack(false);
      });
  }, [selectedRunId, user]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const selectRun = (run: AgentRun) => {
    setSelectedRunId(run.id);
    navigate(`/history/evidence-lab?analysisId=${encodeURIComponent(run.id)}`, { replace: true });
  };

  const reloadPack = () => {
    if (!selectedRunId) return;
    const current = selectedRunId;
    setSelectedRunId(null);
    requestAnimationFrame(() => setSelectedRunId(current));
  };

  const retryAnalysis = async () => {
    if (!selectedRunId || retrying) return;
    setRetrying(true);
    try {
      const result = await apiPost<{ analysisId?: string; retryAnalysisId?: string }>(`/api/v1/analyses/${selectedRunId}/retry`, {});
      await runsQuery.refetch();
      const nextId = result.analysisId ?? result.retryAnalysisId;
      if (nextId) {
        setSelectedRunId(nextId);
        navigate(`/history/evidence-lab?analysisId=${encodeURIComponent(nextId)}`, { replace: true });
      }
      toast.success("已重新运行分析");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新运行失败");
    } finally {
      setRetrying(false);
    }
  };

  const openAdvisor = () => {
    const gaps = pack?.missingEvidence.slice(0, 4).join("；") || "请重新核验当前证据和组合约束";
    const prompt = `请基于分析 ${selectedRunId ?? ""} 继续补齐信息并重新分析。当前缺口：${gaps}。请主动追问我缺失的信息，不要在证据不足时给出可执行交易指令。`;
    navigate(`/advisor?prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><FlaskConical className="size-5 text-primary" /><p className="eyebrow">Evidence Lab</p></div>
          <h1 className="mt-2 text-3xl font-semibold">每一条建议的证据实验室</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">从 Agent 运行历史回到数据、工具、正反证据和合规结论，再决定补充信息、重新分析还是进入模拟。</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/history/decision-log")}><ClipboardList className="size-4" />查看决策日志</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="paper-card self-start p-4 lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Agent 运行历史</p>
            <button type="button" onClick={() => void runsQuery.refetch()} className="text-muted-foreground hover:text-primary" aria-label="刷新运行历史"><RefreshCw className={`size-4 ${runsQuery.isFetching ? "animate-spin" : ""}`} /></button>
          </div>
          {runsQuery.isLoading ? <HistoryLoading /> : runsQuery.isError ? (
            <div className="mt-4 border border-destructive/30 p-4 text-sm">
              <p className="text-destructive">{runsQuery.error instanceof Error ? runsQuery.error.message : "运行历史读取失败"}</p>
              <button className="mt-3 text-primary underline underline-offset-4" onClick={() => void runsQuery.refetch()}>重新读取</button>
            </div>
          ) : runs.length === 0 ? (
            <div className="mt-4 border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
              <p>还没有 Agent 运行记录</p>
              <button className="mt-3 text-primary underline underline-offset-4" onClick={() => navigate("/")}>去首页生成建议</button>
            </div>
          ) : (
            <ul className="mt-4 max-h-[calc(100vh-13rem)] space-y-2 overflow-y-auto pr-1">
              {runs.map((run) => (
                <li key={run.id}>
                  <button onClick={() => selectRun(run)} className={`w-full border px-3 py-3 text-left transition-colors ${selectedRunId === run.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/60"}`}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <RunStatus status={run.status} />
                      <span className="text-muted-foreground">{shortDate(run.startedAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-medium">{run.plannerSummary ?? run.type ?? "多 Agent 运行"}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{run.evidenceCount ?? 0} 条证据</span>
                      <span>{run.skillCount ?? 0} 次 Skill</span>
                      {(run.missingEvidenceCount ?? 0) > 0 ? <span className="text-[hsl(var(--status-watch))]">{run.missingEvidenceCount} 项待补</span> : null}
                      <ChevronRight className="ml-auto size-3 text-primary" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="min-w-0">
          {selectedRun ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
              <div>
                <p className="text-xs text-muted-foreground">当前查看 · {selectedRun.type ?? selectedRun.triggerType}</p>
                <p className="mt-1 font-mono text-xs">{selectedRun.id}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {pack?.recommendationId ? <Button variant="outline" onClick={() => navigate(`/recommendations/${pack.recommendationId}`)}><FileText className="size-4" />查看关联建议</Button> : null}
                <Button variant="outline" onClick={openAdvisor}><MessageCircleQuestion className="size-4" />去顾问补充信息</Button>
                <Button variant="outline" onClick={() => navigate("/simulations")}><GitBranch className="size-4" />进入分支模拟</Button>
                {pack?.retry.allowed ? <Button onClick={() => void retryAnalysis()} disabled={retrying}><RefreshCw className={`size-4 ${retrying ? "animate-spin" : ""}`} />{retrying ? "重新运行中" : "重试本次分析"}</Button> : null}
              </div>
            </div>
          ) : null}

          <section className="paper-card min-h-[28rem] p-5 md:p-7">
            {loadingPack ? (
              <div className="grid min-h-[24rem] place-items-center text-center text-muted-foreground"><div><LoaderCircle className="mx-auto size-6 animate-spin" /><p className="mt-3 text-sm">正在整理证据链…</p></div></div>
            ) : packError ? (
              <div className="grid min-h-[24rem] place-items-center text-center">
                <div><p className="text-sm text-destructive">{packError}</p><Button variant="outline" className="mt-4" onClick={reloadPack}><RefreshCw className="size-4" />重试</Button></div>
              </div>
            ) : pack ? <EvidenceLab evidence={pack} /> : (
              <div className="grid min-h-[24rem] place-items-center text-center text-muted-foreground"><p className="text-sm">从左侧选择一次运行，查看它的完整证据链。</p></div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

function HistoryLoading() {
  return <div className="mt-4 space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse border border-border bg-muted/40" />)}</div>;
}

function RunStatus({ status }: { status: AgentRun["status"] }) {
  const meta: Record<AgentRun["status"], { label: string; className: string }> = {
    succeeded: { label: "已完成", className: "border-primary/30 bg-primary/5 text-primary" },
    blocked: { label: "已阻断", className: "border-destructive/30 bg-destructive/5 text-destructive" },
    failed: { label: "失败", className: "border-destructive/30 bg-destructive/5 text-destructive" },
    running: { label: "运行中", className: "border-[hsl(var(--status-watch))]/40 text-[hsl(var(--status-watch))]" },
    cancelled: { label: "已取消", className: "border-border text-muted-foreground" },
  };
  const current = meta[status];
  return <span className={`border px-2 py-0.5 ${current.className}`}>{current.label}</span>;
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default EvidenceLabPage;
