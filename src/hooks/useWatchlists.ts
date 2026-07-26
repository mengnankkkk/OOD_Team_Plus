"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { invalidateAlertQueries } from "@/hooks/alertKeys";
import {
  createObservationCondition,
  deleteObservationCondition,
  evaluateObservationConditions,
  listObservationConditions,
  updateObservationCondition,
  type ObservationCondition,
  type ObservationConditionCreateInput,
  type ObservationConditionPatch,
} from "@/services/observationConditionService";
import {
  checkWatchlist as checkWatchlistRequest,
  checkWatchlistItem as checkWatchlistItemRequest,
  createWatchlist,
  createWatchlistItem,
  deleteWatchlist,
  listWatchlistItems,
  listWatchlists,
  moveWatchlistItem,
  removeWatchlistItem,
  updateWatchlist,
  updateWatchlistItem,
  type WatchlistCreateInput,
  type WatchlistItem,
  type WatchlistItemCreateInput,
  type WatchlistItemPatch,
  type WatchlistItemRecord,
  type WatchlistItemsResponse,
  type WatchlistPatch,
  type WatchlistStatus,
  type WatchlistSummary,
} from "@/services/watchlistService";

export const watchlistKeys = {
  lists: (userId: string | undefined, status: string) => (
    ["watchlists", userId, status] as const
  ),
  items: (userId: string | undefined, watchlistId: string | null) => (
    ["watchlist-items", userId, watchlistId] as const
  ),
  conditions: (userId: string | undefined, itemId: string | null) => (
    ["observation-conditions", userId, itemId] as const
  ),
};

type EditableWatchlistItem = WatchlistItemRecord | WatchlistItem;
type ConditionMutationContext = {
  watchlistId: string | null;
  itemId: string | null;
};

export function useWatchlists(status: WatchlistStatus = "active") {
  const { user } = useAuth();
  return useQuery({
    queryKey: watchlistKeys.lists(user?.id, status),
    queryFn: () => listWatchlists(status),
    enabled: Boolean(user),
    staleTime: 30_000,
  });
}

export function useWatchlistItems(watchlistId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: watchlistKeys.items(user?.id, watchlistId),
    queryFn: () => listWatchlistItems(watchlistId!),
    enabled: Boolean(user && watchlistId),
    staleTime: 20_000,
  });
}

export function useObservationConditions(itemId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: watchlistKeys.conditions(user?.id, itemId),
    queryFn: () => listObservationConditions(itemId!),
    enabled: Boolean(user && itemId),
    staleTime: 20_000,
  });
}

export function useCreateWatchlist() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WatchlistCreateInput) => createWatchlist(input),
    onSuccess: () => invalidateList(queryClient, user?.id, "active"),
  });
}

export function useUpdateWatchlist() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      item,
      patch,
    }: {
      item: WatchlistSummary;
      patch: WatchlistPatch;
    }) => updateWatchlist(item, patch),
    onSuccess: (_, { item, patch }) => {
      const statuses = new Set<WatchlistStatus>();
      if (item.status === "active" || item.status === "archived") {
        statuses.add(item.status);
      }
      if (patch.status) {
        statuses.add(patch.status.toLowerCase() as WatchlistStatus);
      }
      return Promise.all([
        ...[...statuses].map((status) => (
          invalidateList(queryClient, user?.id, status)
        )),
        invalidateItems(queryClient, user?.id, item.id),
      ]);
    },
  });
}

export function useDeleteWatchlist() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: WatchlistSummary) => deleteWatchlist(item),
    onSuccess: (_, item) => {
      const itemIds = queryClient.getQueryData<WatchlistItemsResponse>(
        watchlistKeys.items(user?.id, item.id),
      )?.items.map((watchlistItem) => watchlistItem.id) ?? [];
      const invalidations = [
        invalidateItems(queryClient, user?.id, item.id),
        ...itemIds.map((itemId) => (
          invalidateConditions(queryClient, user?.id, itemId)
        )),
      ];
      if (item.status === "active" || item.status === "archived") {
        invalidations.push(
          invalidateList(queryClient, user?.id, item.status),
        );
      }
      return Promise.all(invalidations);
    },
  });
}

export function useCreateWatchlistItem(watchlistId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WatchlistItemCreateInput) => (
      createWatchlistItem(requireId(watchlistId), input)
    ),
    onSuccess: (item) => Promise.all([
      invalidateList(queryClient, user?.id, "active"),
      invalidateItems(queryClient, user?.id, watchlistId),
      invalidateConditions(queryClient, user?.id, item.id),
    ]),
  });
}

export function useUpdateWatchlistItem(watchlistId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      item,
      patch,
    }: {
      item: EditableWatchlistItem;
      patch: WatchlistItemPatch;
    }) => updateWatchlistItem(item, patch),
    onSuccess: () => invalidateItems(
      queryClient,
      user?.id,
      watchlistId,
    ),
  });
}

export function useMoveWatchlistItem(sourceWatchlistId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      item,
      targetWatchlistId,
    }: {
      item: EditableWatchlistItem;
      targetWatchlistId: string;
    }) => moveWatchlistItem(item, targetWatchlistId),
    onSuccess: (_, { targetWatchlistId }) => Promise.all([
      invalidateList(queryClient, user?.id, "active"),
      invalidateItems(queryClient, user?.id, sourceWatchlistId),
      invalidateItems(queryClient, user?.id, targetWatchlistId),
    ]),
  });
}

export function useRemoveWatchlistItem(watchlistId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: EditableWatchlistItem) => removeWatchlistItem(item),
    onSuccess: (_, item) => Promise.all([
      invalidateList(queryClient, user?.id, "active"),
      invalidateItems(queryClient, user?.id, watchlistId),
      invalidateConditions(queryClient, user?.id, item.id),
    ]),
  });
}

export function useCheckWatchlist(watchlistId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => checkWatchlistRequest(requireId(watchlistId)),
    onSuccess: (result) => Promise.all([
      invalidateList(queryClient, user?.id, "active"),
      invalidateItems(queryClient, user?.id, watchlistId),
      ...result.itemIds.map((itemId) => (
        invalidateConditions(queryClient, user?.id, itemId)
      )),
      invalidateAlertQueries(queryClient, user?.id),
    ]),
  });
}

export function useCheckWatchlistItem(
  watchlistId: string | null,
  itemId: string | null,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => checkWatchlistItemRequest(requireId(itemId)),
    onSuccess: () => Promise.all([
      invalidateList(queryClient, user?.id, "active"),
      invalidateItems(queryClient, user?.id, watchlistId),
      invalidateConditions(queryClient, user?.id, itemId),
      invalidateAlertQueries(queryClient, user?.id),
    ]),
  });
}

export function useCreateObservationCondition(
  context: ConditionMutationContext,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ObservationConditionCreateInput) => (
      createObservationCondition(input)
    ),
    onSuccess: () => invalidateConditionContext(
      queryClient,
      user?.id,
      context,
      false,
    ),
  });
}

export function useUpdateObservationCondition(
  context: ConditionMutationContext,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      condition,
      patch,
    }: {
      condition: ObservationCondition;
      patch: ObservationConditionPatch;
    }) => updateObservationCondition(condition, patch),
    onSuccess: (_, { patch }) => (
      patch.status
        ? invalidateConditionContext(
          queryClient,
          user?.id,
          context,
          false,
        )
        : invalidateConditions(queryClient, user?.id, context.itemId)
    ),
  });
}

export function useDeleteObservationCondition(
  context: ConditionMutationContext,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (condition: ObservationCondition) => (
      deleteObservationCondition(condition)
    ),
    onSuccess: () => invalidateConditionContext(
      queryClient,
      user?.id,
      context,
      false,
    ),
  });
}

export function useEvaluateObservationConditions(
  context: ConditionMutationContext,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conditionIds,
      reason,
    }: {
      conditionIds?: string[];
      reason?: string;
    } = {}) => evaluateObservationConditions(conditionIds, reason),
    onSuccess: () => invalidateConditionContext(
      queryClient,
      user?.id,
      context,
    ),
  });
}

function invalidateConditionContext(
  queryClient: QueryClient,
  userId: string | undefined,
  context: ConditionMutationContext,
  includeAlerts = true,
) {
  const invalidations = [
    invalidateList(queryClient, userId, "active"),
    invalidateItems(queryClient, userId, context.watchlistId),
    invalidateConditions(queryClient, userId, context.itemId),
  ];
  if (includeAlerts) {
    invalidations.push(invalidateAlertQueries(queryClient, userId));
  }
  return Promise.all(invalidations);
}

function invalidateList(
  queryClient: QueryClient,
  userId: string | undefined,
  status: WatchlistStatus,
) {
  return queryClient.invalidateQueries({
    queryKey: watchlistKeys.lists(userId, status),
    exact: true,
  });
}

function invalidateItems(
  queryClient: QueryClient,
  userId: string | undefined,
  watchlistId: string | null,
) {
  return queryClient.invalidateQueries({
    queryKey: watchlistKeys.items(userId, watchlistId),
    exact: true,
  });
}

function invalidateConditions(
  queryClient: QueryClient,
  userId: string | undefined,
  itemId: string | null,
) {
  return queryClient.invalidateQueries({
    queryKey: watchlistKeys.conditions(userId, itemId),
    exact: true,
  });
}

function requireId(value: string | null): string {
  if (!value) throw new Error("Missing watchlist selection");
  return value;
}
