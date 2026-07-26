import type { QueryClient } from "@tanstack/react-query";

export const alertKeys = {
  root: ["alerts"] as const,
  user: (userId?: string) => ["alerts", userId] as const,
  list: (userId: string | undefined, source: string) => (
    ["alerts", userId, source] as const
  ),
};

export function invalidateAlertQueries(
  queryClient: QueryClient,
  userId?: string,
) {
  return queryClient.invalidateQueries({
    queryKey: alertKeys.user(userId),
    exact: false,
  });
}
