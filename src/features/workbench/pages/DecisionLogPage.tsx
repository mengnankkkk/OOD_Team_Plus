import { Clock, FileSearch, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNavigate } from "@/features/frontend-migration/router";
import { useDecisionLogs } from "@/hooks/useAlerts";
import type { DecisionAction } from "@/types/app/notice";

const ACTION_META: Record<DecisionAction, { label: string; color: string }> = {
  viewed: { label: "查看", color: "text-muted-foreground" },
  followup_question: { label: "追问", color: "text-primary" },
  simulated: { label: "模拟采纳", color: "text-[hsl(var(--status-down))]" },
  revoked: { label: "撤销", color: "text-[hsl(var(--status-watch))]" },
  rejected: { label: "拒绝", color: "text-destructive" },
  later: { label: "稍后处理", color: "text-muted-foreground" },
  commented: { label: "留言", color: "text-primary" },
};

const DecisionLogPage = () => {
  const logsQuery = useDecisionLogs(80);
  const logs = logsQuery.data ?? [];
  const navigate = useNavigate();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">决策日志</p>
          <h1 className="mt-2 text-3xl font-semibold">我当时为什么这么决定</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">模拟采纳、拒绝、撤销和稍后处理都会保留当时的建议快照，并能回到原建议与证据链。</p>
        </div>
        <Button variant="outline" onClick={() => void logsQuery.refetch()} disabled={logsQuery.isFetching}><RefreshCw className={`size-4 ${logsQuery.isFetching ? "animate-spin" : ""}`} />刷新</Button>
      </div>

      {logsQuery.isLoading ? <p className="text-muted-foreground">读取决策日志…</p> : logsQuery.isError ? (
        <div className="paper-card grid place-items-center p-10 text-center">
          <p className="text-sm text-destructive">{logsQuery.error instanceof Error ? logsQuery.error.message : "决策日志读取失败"}</p>
          <Button variant="outline" className="mt-4" onClick={() => void logsQuery.refetch()}><RefreshCw className="size-4" />重新读取</Button>
        </div>
      ) : logs.length === 0 ? (
        <div className="paper-card grid place-items-center p-12 text-center text-muted-foreground">
          <Clock className="size-8" />
          <p className="mt-3">尚未有决策记录</p>
          <p className="mt-1 text-sm">打开一条可参考的建议进行模拟采纳、拒绝或稍后处理，日志会自动生成。</p>
        </div>
      ) : (
        <ol className="relative border-l border-border pl-6">
          {logs.map((log) => {
            const action = ACTION_META[log.action] ?? ACTION_META.viewed;
            const title = snapshotTitle(log.agentSnapshot);
            return (
              <li key={log.id} className="mb-6 last:mb-0">
                <span className="absolute -left-2.5 grid size-4 place-items-center rounded-full border-2 border-background bg-primary" />
                <article className="paper-card p-5">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className={`font-medium ${action.color}`}>{action.label}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold">{title}</h2>
                  {log.reason ? <div className="mt-3 border-l-2 border-primary pl-3"><p className="text-xs text-muted-foreground">当时的原因</p><p className="mt-1 text-sm">{log.reason}</p></div> : null}
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                    {log.analysisId ? <Button variant="outline" size="sm" onClick={() => navigate(`/history/evidence-lab?analysisId=${encodeURIComponent(log.analysisId!)}`)}><FileSearch className="size-4" />查看证据</Button> : null}
                    {log.recommendationId ? <Button variant="outline" size="sm" onClick={() => navigate(`/recommendations/${log.recommendationId}`)}>回到当时的建议</Button> : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

function snapshotTitle(snapshot: Record<string, unknown>) {
  return String(snapshot.summary ?? snapshot.headline ?? snapshot.action ?? "当时的投资建议");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export default DecisionLogPage;
