import { useMemo } from "react";
import { useNavigate } from "@/features/frontend-migration/router";
import { useAuth } from "@/hooks/useAuth";
import { useAlerts } from "@/hooks/useAlerts";
import { updateAlertStatus } from "@/services/alertsService";
import type { Alert } from "@/types/app/notice";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, AlertTriangle, Info, Eye } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const SEVERITY_META: Record<Alert["severity"], { label: string; className: string; icon: React.ReactNode }> = {
  urgent: { label: "紧急", className: "border-destructive/60 text-destructive", icon: <AlertTriangle className="size-4" /> },
  important: { label: "重要", className: "border-[hsl(var(--status-watch))]/60 text-[hsl(var(--status-watch))]", icon: <Bell className="size-4" /> },
  watch: { label: "关注", className: "border-primary/40 text-primary", icon: <Eye className="size-4" /> },
  info: { label: "信息", className: "border-muted-foreground/40 text-muted-foreground", icon: <Info className="size-4" /> },
};

const AlertsPage = () => {
  const { user } = useAuth();
  const { data: alerts = [], isLoading } = useAlerts();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const grouped = useMemo(() => {
    const buckets: Record<Alert["severity"], Alert[]> = { urgent: [], important: [], watch: [], info: [] };
    for (const a of alerts) buckets[a.severity].push(a);
    return buckets;
  }, [alerts]);

  const handleView = async (alert: Alert) => {
    if (!user) return;
    if (alert.status === "unread") {
      await updateAlertStatus(user.id, alert.id, "read");
      qc.invalidateQueries({ queryKey: ["alerts"] });
    }
    if (alert.recommendationId) navigate(`/recommendations/${alert.recommendationId}`);
  };

  const handleDismiss = async (alert: Alert) => {
    if (!user) return;
    try {
      await updateAlertStatus(user.id, alert.id, "dismissed");
      toast.success("已忽略");
      qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (err: any) {
      toast.error(err?.message ?? "操作失败");
    }
  };

  return (
    <div>
      <div className="mb-6"><p className="eyebrow">提醒中心</p><h1 className="mt-2 text-3xl font-semibold">按重要程度排列，避免消息轰炸</h1><p className="mt-2 text-sm text-muted-foreground">数据、市场触发、Agent 结论一旦变化，我会主动推到这里，并写入你的决策日志。</p></div>

      {isLoading ? <p className="text-muted-foreground">加载提醒…</p> : alerts.length === 0 ? (
        <div className="paper-card grid place-items-center p-12 text-center text-muted-foreground">
          <Bell className="size-8" />
          <p className="mt-3">目前一切平稳，没有需要立即处理的提醒</p>
        </div>
      ) : (
        <div className="space-y-8">
          {(["urgent", "important", "watch", "info"] as Alert["severity"][]).map((sev) => {
            const list = grouped[sev];
            if (!list.length) return null;
            const meta = SEVERITY_META[sev];
            return (
              <section key={sev}>
                <div className={`flex items-center gap-2 border-b border-border pb-2`}>
                  <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${meta.className}`}>{meta.icon}{meta.label}</span>
                  <span className="text-xs text-muted-foreground">{list.length} 条</span>
                </div>
                <ul className="mt-4 space-y-3">
                  {list.map((a) => (
                    <li key={a.id} className={`paper-card p-5 ${a.status === "unread" ? "border-l-4 border-l-primary" : ""}`}>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="font-medium">{a.title}</p>
                          {a.message && <p className="mt-2 text-sm text-muted-foreground">{a.message}</p>}
                          <p className="mt-3 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString("zh-CN")}</p>
                        </div>
                        <div className="flex gap-2">
                          {a.recommendationId && <Button size="sm" onClick={() => handleView(a)}>查看分析与模拟</Button>}
                          <Button size="sm" variant="ghost" onClick={() => handleDismiss(a)}>忽略</Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AlertsPage;
