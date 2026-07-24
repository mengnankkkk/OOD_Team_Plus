import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listGoals } from "@/services/goalService";
import { useAuth } from "@/hooks/useAuth";

export function useUserGoals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["goals", user?.id],
    queryFn: () => listGoals(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useUserGoalsInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["goals"] });
}
