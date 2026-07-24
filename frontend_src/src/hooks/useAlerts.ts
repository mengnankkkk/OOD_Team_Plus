import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAlerts, listDecisionLogs, subscribeAlerts } from "@/services/alertsService";
import { useAuth } from "@/hooks/useAuth";

export function useAlerts() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["alerts", user?.id],
    queryFn: () => listAlerts(user!.id, { statuses: ["unread", "read"] }),
    enabled: !!user,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeAlerts(user.id, () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["agent-runs"] });
    });
    return unsubscribe;
  }, [user, qc]);

  return query;
}

export function useDecisionLogs(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["decision-logs", user?.id, limit],
    queryFn: () => listDecisionLogs(user!.id, limit),
    enabled: !!user,
    staleTime: 20_000,
  });
}
