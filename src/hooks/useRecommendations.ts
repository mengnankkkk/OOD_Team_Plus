import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAgentRuns, listRecommendations } from "@/services/recommendationService";
import { useAuth } from "@/hooks/useAuth";

export function useRecommendations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["recommendations", user?.id],
    queryFn: () => listRecommendations(user!.id, { statuses: ["active", "simulated"], limit: 20 }),
    enabled: !!user,
    staleTime: 10_000,
  });
}

export function useAgentRuns(limit = 6) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["agent-runs", user?.id, limit],
    queryFn: () => listAgentRuns(user!.id, limit),
    enabled: !!user,
    staleTime: 10_000,
  });
}

export function useRecommendationInvalidator() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["recommendations"] });
    qc.invalidateQueries({ queryKey: ["agent-runs"] });
    qc.invalidateQueries({ queryKey: ["alerts"] });
  };
}
