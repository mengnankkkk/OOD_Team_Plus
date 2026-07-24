import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listHoldings } from "@/services/holdingsService";
import { useAuth } from "@/hooks/useAuth";

export function useHoldings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["holdings", user?.id],
    queryFn: () => listHoldings(user!.id),
    enabled: !!user,
    staleTime: 20_000,
  });
}

export function useHoldingsInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["holdings"] });
}
