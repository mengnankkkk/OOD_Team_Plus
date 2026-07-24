import { useNavigate } from "react-router-dom";
import { useDecisionLogs } from "@/hooks/useAlerts";
import type { DecisionAction } from "@/types/app/notice";
import { Clock } from "lucide-react";

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
  const { data: logs = [], isLoading } = useDecisionLogs(80);
  const navigate = useNavigate();

  return (
    <div>
      <div className="mb-6"><p className="eyebrow">决策日志</p><h1 className="mt-2 text-3xl font-semibold">我当时为什么这么决定</h1><p className="mt-2 text-sm text-muted-foreground">每一次查看、追问、模拟采纳、拒绝或撤销都保留下来，可反复回看。</p></div>

      {isLoading ? <p className="text-muted-foreground">读取决策日志…</p> : logs.length === 0 ? (
        <div className="paper-card grid place-items-center p-12 text-center text-muted-foreground">
          <Clock className="size-8" />
          <p className="mt-3">尚未有决策记录 · 打开一条建议开始互动，日志会自动生成</p>
        </div>
      ) : (
        <ol className="relative border-l border-border pl-6">
          {logs.map((log) => {
            const meta = ACTION_META[log.action];
            return (
              <li key={log.id} className="mb-6 last:mb-0">
                <span className={`absolute -left-2.5 grid size-4 place-items-center rounded-full border-2 border-background bg-primary`}></span>
                <div className="paper-card p-4">
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                    <span className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                    {log.recommendationId && (
                      <button onClick={() => navigate(`/recommendations/${log.recommendationId}`)} className="ml-auto text-xs text-primary underline underline-offset-4">回到当时的建议</button>
                    )}
                  </div>
                  {log.reason && <p className="mt-2 text-sm text-muted-foreground">{log.reason}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

export default DecisionLogPage;
