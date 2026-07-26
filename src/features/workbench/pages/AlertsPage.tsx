import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, BellRing, Check, CheckCheck, ChevronRight, CircleDot, Clock3, RefreshCw, Settings2, ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useNavigate } from "@/features/frontend-migration/router";
import { useAuth } from "@/hooks/useAuth";
import { useAlerts, useAlertSyncState } from "@/hooks/useAlerts";
import { markAllAlertsRead, syncAlerts, updateAlertStatus } from "@/services/alertsService";
import type { Alert } from "@/types/app/notice";

type Filter = "active" | "unread" | "important" | "events";

const severityMeta: Record<Alert["severity"], { label: string; icon: typeof Bell; tone: string; marker: string }> = {
  urgent: { label: "紧急", icon: ShieldAlert, tone: "text-destructive", marker: "bg-destructive" },
  important: { label: "重要", icon: AlertTriangle, tone: "text-amber-700 dark:text-amber-400", marker: "bg-amber-500" },
  watch: { label: "关注", icon: CircleDot, tone: "text-primary", marker: "bg-primary" },
  info: { label: "信息", icon: Bell, tone: "text-muted-foreground", marker: "bg-muted-foreground" },
};

const sourceLabels: Record<string, string> = {
  PORTFOLIO_RISK: "持仓风险",
  PORTFOLIO_GAIN: "浮盈管理",
  CONCENTRATION_RISK: "集中度",
  PORTFOLIO_HEALTH: "组合健康",
  MARKET_MOVE: "持仓异动",
  WATCHLIST_MOVE: "自选异动",
  WATCHLIST_DRAWDOWN: "自选回撤",
  WATCHLIST_EVENT: "关联事件",
  WATCH_CONDITION: "自定义条件",
  DATA_QUALITY: "数据质量",
  DATA_FRESHNESS: "数据时效",
};

const AlertsPage = () => {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("active");
  const allAlerts = useAlerts();
  const eventAlerts = useAlerts({
    sourceType: "WATCHLIST_EVENT",
    enabled: filter === "events",
    browserNotifications: false,
  });
  const isLoading = filter === "events" ? eventAlerts.isLoading : allAlerts.isLoading;
  const syncState = useAlertSyncState();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const initialSyncStarted = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [browserAlerts, setBrowserAlerts] = useState(false);

  useEffect(() => {
    setBrowserAlerts(typeof window !== "undefined" && window.localStorage.getItem("mw-browser-alerts") === "enabled" && "Notification" in window && Notification.permission === "granted");
  }, []);

  useEffect(() => {
    if (!user || initialSyncStarted.current) return;
    initialSyncStarted.current = true;
    void syncAlerts(false).then(() => {
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      void qc.invalidateQueries({ queryKey: ["alert-sync-state"] });
    }).catch(() => undefined);
  }, [qc, user]);

  const baseAlerts = allAlerts.data?.items ?? [];
  const unreadCount = allAlerts.data?.unreadCount ?? 0;
  const urgentCount = baseAlerts.filter((item) => item.severity === "urgent" && item.status !== "dismissed").length;
  const importantCount = baseAlerts.filter((item) => ["urgent", "important"].includes(item.severity) && item.status !== "dismissed").length;
  const filtered = useMemo(() => {
    const alerts = filter === "events"
      ? eventAlerts.data?.items ?? []
      : allAlerts.data?.items ?? [];
    return alerts.filter((item) => {
      if (filter === "unread") return item.status === "unread";
      if (filter === "important") return item.status !== "dismissed" && ["urgent", "important"].includes(item.severity);
      if (filter === "events") return item.status !== "dismissed" && item.sourceType === "WATCHLIST_EVENT";
      return item.status !== "dismissed";
    });
  }, [allAlerts.data, eventAlerts.data, filter]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAlerts(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["alerts"] }),
        qc.invalidateQueries({ queryKey: ["alert-sync-state"] }),
        qc.invalidateQueries({ queryKey: ["holdings"] }),
      ]);
      if (result.skippedReason === "MUTED") toast.info("提醒已暂停，本次未执行同步");
      else if (result.status === "partial") toast.warning(result.errorMessage ?? "部分行情未更新，已使用最近一次有效数据");
      else toast.success(result.createdCount ? `发现 ${result.createdCount} 条新提醒` : "行情与提醒已是最新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const updateStatus = async (alert: Alert, status: "read" | "dismissed") => {
    if (!user) return;
    try {
      await updateAlertStatus(user.id, alert.id, status);
      await qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const askAdvisor = async (alert: Alert) => {
    if (alert.status === "unread") await updateStatus(alert, "read");
    const prompt = typeof alert.metadata.advisorPrompt === "string"
      ? alert.metadata.advisorPrompt
      : `请结合我的画像和当前持仓分析这条提醒：${alert.title}。${alert.message ?? ""}`;
    navigate(`/advisor?prompt=${encodeURIComponent(prompt)}&source=notification&id=${encodeURIComponent(alert.id)}`);
  };

  const markAllRead = async () => {
    const count = await markAllAlertsRead();
    await qc.invalidateQueries({ queryKey: ["alerts"] });
    toast.success(count ? `已将 ${count} 条提醒标记为已读` : "没有未读提醒");
  };

  const toggleBrowserAlerts = async () => {
    if (!("Notification" in window)) { toast.error("当前浏览器不支持系统通知"); return; }
    if (browserAlerts) {
      window.localStorage.removeItem("mw-browser-alerts");
      setBrowserAlerts(false);
      toast.success("已关闭浏览器通知");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { toast.error("浏览器未授予通知权限"); return; }
    window.localStorage.setItem("mw-browser-alerts", "enabled");
    setBrowserAlerts(true);
    toast.success("浏览器通知已开启");
  };

  return (
    <div className="page-stack alerts-workbench">
      <header className="page-heading">
        <div>
          <span className="section-kicker">SIGNAL DESK</span>
          <h1>提醒中心</h1>
          <p>只保留需要复核的持仓事实、组合风险和自选异动。每条提醒都标注行情时间，并可直接交给顾问继续分析。</p>
        </div>
        <div className="heading-actions">
          <Button variant="outline" onClick={() => void toggleBrowserAlerts()} title={browserAlerts ? "关闭浏览器通知" : "开启浏览器通知"}>
            {browserAlerts ? <BellRing className="size-4" /> : <Bell className="size-4" />}{browserAlerts ? "系统通知已开" : "开启系统通知"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/notification-preference")}><Settings2 className="size-4" />通知偏好</Button>
          <Button onClick={() => void runSync()} disabled={syncing}><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "同步中" : "同步行情"}</Button>
        </div>
      </header>

      <section className="alerts-summary" aria-label="提醒概况">
        <div><span>待处理</span><strong>{unreadCount}</strong><small>未读提醒</small></div>
        <div><span>优先复核</span><strong>{importantCount}</strong><small>重要与紧急</small></div>
        <div><span>紧急风险</span><strong>{urgentCount}</strong><small>高风险阈值</small></div>
        <div className="alerts-data-state">
          <span>行情状态</span>
          <strong className={syncState.data?.status === "partial" || syncState.data?.status === "failed" ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
            {syncState.data?.status === "partial" ? "部分可用" : syncState.data?.status === "failed" ? "同步失败" : syncState.data?.status === "running" ? "同步中" : "已连接"}
          </strong>
          <small>{syncState.data?.dataAsOf ? `截至 ${formatTime(syncState.data.dataAsOf)}` : "等待首次同步"}</small>
        </div>
      </section>

      {syncState.data?.errorMessage ? <div className="alerts-quality-note"><Clock3 className="size-4" /><span>{syncState.data.errorMessage}</span><button onClick={() => void runSync()}>重试</button></div> : null}

      <section className="alerts-stream">
        <div className="alerts-toolbar">
          <div className="alerts-filter" role="tablist" aria-label="提醒筛选">
            {([
              ["active", "全部"],
              ["unread", `未读 ${unreadCount}`],
              ["important", `优先 ${importantCount}`],
              ["events", "关联事件"],
            ] as Array<[Filter, string]>).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void markAllRead()} disabled={unreadCount === 0}><CheckCheck className="size-4" />全部已读</Button>
        </div>

        {isLoading ? <div className="state-panel"><RefreshCw className="size-5 animate-spin" />正在读取提醒</div> : filtered.length === 0 ? (
          <div className="alerts-empty"><Check className="size-8" /><strong>{filter === "unread" ? "没有未读提醒" : "目前没有需要复核的信号"}</strong><span>后台仍会按周期检查真实行情与观察条件。</span></div>
        ) : (
          <div className="alerts-list">
            {filtered.map((alert) => {
              const meta = severityMeta[alert.severity];
              const Icon = meta.icon;
              return <article key={alert.id} className={`alert-row ${alert.status === "unread" ? "is-unread" : ""}`}>
                <span className={`alert-marker ${meta.marker}`} aria-hidden="true" />
                <div className={`alert-icon ${meta.tone}`}><Icon className="size-4" /></div>
                <div className="alert-copy">
                  <div className="alert-meta">
                    <span className={meta.tone}>{meta.label}</span>
                    <span>{sourceLabels[alert.sourceType] ?? alert.sourceType}</span>
                    {alert.metadata.symbol ? <span className="font-mono">{String(alert.metadata.symbol)}</span> : null}
                    {alert.occurrenceCount > 1 ? <span>累计 {alert.occurrenceCount} 次</span> : null}
                  </div>
                  <h2>{alert.title}</h2>
                  {alert.message ? <p>{alert.message}</p> : null}
                  <div className="alert-timestamp"><Clock3 className="size-3.5" /><span>生成 {formatTime(alert.createdAt)}</span>{alert.dataAsOf ? <span>数据 {formatTime(alert.dataAsOf)}</span> : null}</div>
                </div>
                <div className="alert-actions">
                  <Button size="sm" onClick={() => void askAdvisor(alert)}><Sparkles className="size-4" />问顾问<ChevronRight className="size-4" /></Button>
                  {alert.status === "unread" ? <button type="button" className="alert-icon-action" title="标记已读" aria-label="标记已读" onClick={() => void updateStatus(alert, "read")}><Check className="size-4" /></button> : null}
                  <button type="button" className="alert-icon-action" title="忽略提醒" aria-label="忽略提醒" onClick={() => void updateStatus(alert, "dismissed")}><X className="size-4" /></button>
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
};

function formatTime(value: string): string {
  const normalized = /^\d{8}$/u.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00+08:00` : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default AlertsPage;
