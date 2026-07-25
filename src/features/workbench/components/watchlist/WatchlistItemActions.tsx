import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WatchlistCard } from "@/features/workbench/components/watchlist/WatchlistCard";
import { useCheckWatchlistItem } from "@/hooks/useWatchlists";
import type {
  WatchlistCheckResult,
  WatchlistItem,
  WatchlistSummary,
} from "@/services/watchlistService";

import { formatDateTime, formatPercentRatio } from "./watchlist-format";

export function WatchlistCardController(props: {
  item: WatchlistItem;
  watchlistId: string | null;
  onAskAdvisor: () => void;
  onEdit: () => void;
  onConditions: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const check = useCheckWatchlistItem(props.watchlistId, props.item.id);
  const runCheck = async () => {
    try {
      showCheckResult(await check.mutateAsync());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "标的检查失败");
    }
  };
  return (
    <WatchlistCard
      item={props.item}
      checking={check.isPending}
      onAskAdvisor={props.onAskAdvisor}
      onCheck={() => void runCheck()}
      onEdit={props.onEdit}
      onManageConditions={props.onConditions}
      onMove={props.onMove}
      onRemove={props.onRemove}
    />
  );
}

export function MoveWatchlistItemDialog(props: {
  item: WatchlistItem | null;
  activeListId: string | null;
  lists: WatchlistSummary[];
  targetId: string;
  pending: boolean;
  onTargetChange: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(props.item)} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动观察对象</DialogTitle>
          <DialogDescription>将「{props.item?.name}」移动到另一个活动列表。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>目标列表</Label>
          <Select value={props.targetId} onValueChange={props.onTargetChange}>
            <SelectTrigger aria-label="目标列表"><SelectValue placeholder="选择目标列表" /></SelectTrigger>
            <SelectContent>
              {props.lists.filter((list) => list.id !== props.activeListId).map((list) => (
                <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={props.onClose}>取消</Button>
          <Button type="button" onClick={props.onConfirm} disabled={!props.targetId || props.pending}>
            {props.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            确认移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveWatchlistItemDialog(props: {
  item: WatchlistItem | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(props.item)} onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除观察对象？</AlertDialogTitle>
          <AlertDialogDescription>
            「{props.item?.name}」会从当前列表移除，活动规则将暂停；历史提醒与事件仍会保留。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm} className="bg-destructive text-destructive-foreground">
            确认移除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function showCheckResult(result: WatchlistCheckResult) {
  if (result.status === "SUCCEEDED") {
    toast.success(`检查完成：${result.checkedItemCount} 个标的，新增 ${result.createdNotificationCount} 条提醒`);
  } else if (result.status === "PARTIAL") {
    toast.warning(result.errorMessage ?? "部分行情未更新，已使用最近一次有效数据");
  } else {
    toast.error(result.errorMessage ?? "检查失败");
  }
}

export function advisorUrl(item: WatchlistItem): string {
  const rule = item.drawdown_threshold_bps == null
    ? `${item.activeConditionCount} 条活动规则`
    : `近 20 日回撤达到 ${formatPercentRatio(item.drawdown_threshold_bps / 10_000)}`;
  const prompt = [
    `请分析观察对象 ${item.name}（${item.symbol}）。`,
    `我的关注理由：${item.reason ?? "未填写"}。`,
    `关联目标：${item.goal?.name ?? "未关联"}；计划期限：${item.plannedHorizon ?? "未设置"}。`,
    `当前规则：${rule}。`,
    `最新价格：${item.market.price ?? "数据不足"}，单日变化：${formatPercentRatio(item.market.dailyMovePct)}，持仓权重：${formatPercentRatio(item.portfolioRelation.weight)}。`,
    `行情数据时间：${formatDateTime(item.market.dataAsOf)}。`,
    "请给出支持证据、反方证据、组合影响、后续观察条件和可模拟方案；不要直接替我下单。",
  ].join("");
  return `/advisor?prompt=${encodeURIComponent(prompt)}&source=watchlist&id=${encodeURIComponent(item.id)}`;
}
