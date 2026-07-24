import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import EvidenceLab from "@/components/desktop/EvidenceLab";
import { useAuth } from "@/hooks/useAuth";
import { useAgentRuns } from "@/hooks/useRecommendations";
import { sb } from "@/services/supabaseClient";
import type { EvidencePack } from "@/types/app/recommendation";
import { FlaskConical, ChevronRight } from "lucide-react";

const EvidenceLabPage = () => {
  const { user } = useAuth();
  const { data: runs = [], isLoading } = useAgentRuns(20);
  const navigate = useNavigate();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);

  useEffect(() => {
    if (runs.length && !selectedRunId) setSelectedRunId(runs[0].id);
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!user || !selectedRunId) return;
    setLoadingPack(true);
    sb.from("evidence_packs")
      .select("*")
      .eq("user_id", user.id)
      .eq("agent_run_id", selectedRunId)
      .order("created_at", { ascending: false })
      .range(0, 0)
      .then(({ data }: any) => {
        if (data && data.length) {
          const row = data[0];
          setPack({
            id: row.id,
            recommendationId: row.recommendation_id,
            agentRunId: row.agent_run_id,
            dataSnapshots: row.data_snapshots ?? [],
            skillRuns: row.skill_runs ?? [],
            workflowDag: row.workflow_dag ?? { nodes: [], edges: [] },
            researchMetrics: row.research_metrics ?? {},
            simulationLog: row.simulation_log ?? [],
            riskVerdicts: row.risk_verdicts ?? [],
            createdAt: row.created_at,
          });
        } else {
          setPack(null);
        }
        setLoadingPack(false);
      });
  }, [user, selectedRunId]);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2"><FlaskConical className="size-5 text-primary" /><p className="eyebrow">Evidence Lab</p></div>
          <h1 className="mt-2 text-3xl font-semibold">每一条建议的证据实验室</h1>
          <p className="mt-2 text-sm text-muted-foreground">展开后可查看 Pandadata 路由、Skill 运行、Agent DAG、支持与反方证据、回测假设、风控拦截原因。</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="paper-card p-4">
          <p className="eyebrow mb-3">Agent 运行历史</p>
          {isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : runs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">尚无运行记录<button className="mt-3 text-primary underline underline-offset-4" onClick={() => navigate("/")}>去首页运行一次</button></div>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => (
                <li key={run.id}>
                  <button onClick={() => setSelectedRunId(run.id)} className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${selectedRunId === run.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary"}`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${run.status === "succeeded" ? "bg-[hsl(var(--status-down))]/10 text-[hsl(var(--status-down))]" : "bg-muted text-muted-foreground"}`}>{run.status === "succeeded" ? "已完成" : run.status}</span>
                      <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{run.plannerSummary ?? "多 Agent 运行"}</p>
                    <div className="mt-1 flex items-center text-xs text-primary">查看 <ChevronRight className="size-3" /></div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="paper-card p-6">
          {loadingPack ? <p className="text-sm text-muted-foreground">读取证据包…</p> : pack ? <EvidenceLab evidence={pack} /> : <p className="text-sm text-muted-foreground">该运行未生成证据包</p>}
        </section>
      </div>
    </div>
  );
};

export default EvidenceLabPage;
