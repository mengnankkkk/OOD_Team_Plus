import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConditionSheet } from "@/features/workbench/components/watchlist/ConditionSheet";
import { WatchlistEditorDialog } from "@/features/workbench/components/watchlist/WatchlistEditorDialog";
import {
  advisorUrl,
  MoveWatchlistItemDialog,
  RemoveWatchlistItemDialog,
  showCheckResult,
  WatchlistCardController,
} from "@/features/workbench/components/watchlist/WatchlistItemActions";
import { WatchlistManagerDialog } from "@/features/workbench/components/watchlist/WatchlistManagerDialog";
import { WatchlistSummary } from "@/features/workbench/components/watchlist/WatchlistSummary";
import { WatchlistToolbar } from "@/features/workbench/components/watchlist/WatchlistToolbar";
import { useNavigate, useSearchParams } from "@/features/frontend-migration/router";
import {
  useCheckWatchlist,
  useCreateWatchlist,
  useMoveWatchlistItem,
  useRemoveWatchlistItem,
  useWatchlistItems,
  useWatchlists,
} from "@/hooks/useWatchlists";
import { useUserGoals } from "@/hooks/useUserGoals";
import type { WatchlistItem } from "@/services/watchlistService";

const DEFAULT_LIST_NAME = "持仓观测";

const WatchlistPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeLists = useWatchlists("active");
  const archivedLists = useWatchlists("archived");
  const createList = useCreateWatchlist();
  const defaultCreationStarted = useRef(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WatchlistItem | null>(null);
  const [conditionItem, setConditionItem] = useState<WatchlistItem | null>(null);
  const [moveItem, setMoveItem] = useState<WatchlistItem | null>(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [removeItem, setRemoveItem] = useState<WatchlistItem | null>(null);
  const goals = useUserGoals();

  const requestedListId = searchParams.get("list");
  const activeList = useMemo(() => {
    const lists = activeLists.data ?? [];
    return lists.find((list) => list.id === requestedListId)
      ?? lists.find((list) => list.name === DEFAULT_LIST_NAME)
      ?? lists[0]
      ?? null;
  }, [activeLists.data, requestedListId]);
  const activeListId = activeList?.id ?? null;
  const items = useWatchlistItems(activeListId);
  const checkList = useCheckWatchlist(activeListId);
  const moveMutation = useMoveWatchlistItem(activeListId);
  const removeMutation = useRemoveWatchlistItem(activeListId);

  useEffect(() => {
    if (activeLists.isLoading || activeLists.error || activeLists.data?.length
      || defaultCreationStarted.current || createList.isPending) return;
    defaultCreationStarted.current = true;
    void createList.mutateAsync({
      name: DEFAULT_LIST_NAME,
      description: "围绕目标、规则和真实证据持续观察",
    }).then((created) => {
      replaceListParam(created.id);
    }).catch((error) => {
      defaultCreationStarted.current = false;
      toast.error(error instanceof Error ? error.message : "默认观察列表创建失败");
    });
  }, [activeLists.data, activeLists.error, activeLists.isLoading, createList, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeListId || requestedListId === activeListId) return;
    replaceListParam(activeListId);
  }, [activeListId, requestedListId]);

  const selectList = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("list", id);
    setSearchParams(params);
  };

  const runListCheck = async () => {
    try {
      const result = await checkList.mutateAsync();
      showCheckResult(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "列表检查失败");
    }
  };

  const move = async () => {
    if (!moveItem || !moveTargetId) return;
    try {
      await moveMutation.mutateAsync({ item: moveItem, targetWatchlistId: moveTargetId });
      toast.success(`已将「${moveItem.name}」移动到目标列表`);
      setMoveItem(null);
      setMoveTargetId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移动失败");
    }
  };

  const remove = async () => {
    if (!removeItem) return;
    try {
      await removeMutation.mutateAsync(removeItem);
      toast.success(`已移除「${removeItem.name}」`);
      setRemoveItem(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移除失败");
    }
  };

  const openCreate = () => {
    setEditingItem(null);
    setEditorOpen(true);
  };

  const pageLoading = activeLists.isLoading || createList.isPending;
  const loadError = activeLists.error ?? items.error;

  return (
    <div className="page-stack watchlist-workbench">
      <header className="page-heading">
        <div>
          <span className="section-kicker">OBSERVATION DESK</span>
          <h1>持仓观测</h1>
          <p>按目标与规则持续观察已持有和未持有标的。高级状态只展示真实证据，缺失数据会明确标注。</p>
        </div>
      </header>

      <WatchlistToolbar
        lists={activeLists.data ?? []}
        activeListId={activeListId}
        checking={checkList.isPending}
        onSelectList={selectList}
        onManageLists={() => setManagerOpen(true)}
        onCheck={() => void runListCheck()}
        onAdd={openCreate}
      />

      {items.data ? <WatchlistSummary {...items.data.summary} /> : null}

      {loadError ? (
        <div className="state-panel error">
          <strong>观察数据加载失败</strong>
          <span>{loadError instanceof Error ? loadError.message : "请稍后重试"}</span>
          <Button type="button" variant="outline" onClick={() => void Promise.all([activeLists.refetch(), items.refetch()])}>
            <RefreshCw className="size-4" />重新加载
          </Button>
        </div>
      ) : pageLoading || items.isLoading ? (
        <div className="state-panel"><LoaderCircle className="size-5 animate-spin" />正在加载持仓观测</div>
      ) : !activeList ? (
        <div className="state-panel"><LoaderCircle className="size-5 animate-spin" />正在创建默认观察列表</div>
      ) : !items.data?.items.length ? (
        <div className="watchlist-empty">
          <Eye className="size-9" />
          <strong>当前列表还没有观察对象</strong>
          <span>添加一个真实标的，写下关注理由，并用结构化规则定义何时需要复核。</span>
          <Button type="button" onClick={openCreate}>添加第一个标的</Button>
        </div>
      ) : (
        <section className="watchlist-grid" aria-label={`${activeList.name}观察对象`}>
          {items.data.items.map((item) => (
            <WatchlistCardController
              key={item.id}
              item={item}
              watchlistId={activeListId}
              onAskAdvisor={() => navigate(advisorUrl(item))}
              onEdit={() => {
                setEditingItem(item);
                setEditorOpen(true);
              }}
              onConditions={() => setConditionItem(item)}
              onMove={() => {
                setMoveTargetId("");
                setMoveItem(item);
              }}
              onRemove={() => setRemoveItem(item)}
            />
          ))}
        </section>
      )}

      <WatchlistEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        watchlistId={activeListId}
        item={editingItem}
        goals={goals.data ?? []}
      />
      <WatchlistManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        activeLists={activeLists.data ?? []}
        archivedLists={archivedLists.data ?? []}
      />
      <ConditionSheet
        open={Boolean(conditionItem)}
        onOpenChange={(open) => !open && setConditionItem(null)}
        watchlistId={activeListId}
        item={conditionItem}
      />

      <MoveWatchlistItemDialog
        item={moveItem}
        activeListId={activeListId}
        lists={activeLists.data ?? []}
        targetId={moveTargetId}
        pending={moveMutation.isPending}
        onTargetChange={setMoveTargetId}
        onClose={() => setMoveItem(null)}
        onConfirm={() => void move()}
      />
      <RemoveWatchlistItemDialog
        item={removeItem}
        onClose={() => setRemoveItem(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
};

export default WatchlistPage;

function replaceListParam(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("list", id);
  window.history.replaceState(window.history.state, "", url);
}
