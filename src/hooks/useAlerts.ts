import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAlertSyncState, listAlerts, listDecisionLogs, subscribeAlerts } from "@/services/alertsService";
import { useAuth } from "@/hooks/useAuth";
import { alertKeys } from "@/hooks/alertKeys";

export function useAlerts(options: {
  sourceType?: string;
  enabled?: boolean;
  browserNotifications?: boolean;
} = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const seenIds = useRef<Set<string> | null>(null);

  const query = useQuery({
    queryKey: alertKeys.list(user?.id, options.sourceType ?? "all"),
    queryFn: () => listAlerts(user!.id, {
      statuses: ["unread", "read"],
      sourceType: options.sourceType,
    }),
    enabled: !!user && options.enabled !== false,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeAlerts(user.id, () => {
      qc.invalidateQueries({ queryKey: alertKeys.root });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["agent-runs"] });
    });
    return unsubscribe;
  }, [user, qc]);

  useEffect(() => {
    if (!query.data || options.browserNotifications === false) return;
    const nextIds = new Set(query.data.items.map((item) => item.id));
    if (seenIds.current && typeof window !== "undefined" && window.localStorage.getItem("mw-browser-alerts") === "enabled" && "Notification" in window && Notification.permission === "granted") {
      for (const item of query.data.items) {
        if (!seenIds.current.has(item.id) && item.status === "unread") new Notification(item.title, { body: item.message ?? undefined, tag: item.id });
      }
    }
    seenIds.current = nextIds;
  }, [options.browserNotifications, query.data]);

  return query;
}

export function useAlertSyncState() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["alert-sync-state", user?.id],
    queryFn: getAlertSyncState,
    enabled: !!user,
    staleTime: 15_000,
  });
}

export function useDecisionLogs(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["decision-logs", user?.id, limit],
    queryFn: () => listDecisionLogs(user!.id, limit),
    enabled: !!user,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}
