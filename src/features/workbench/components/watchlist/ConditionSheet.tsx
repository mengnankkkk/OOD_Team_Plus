import { useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useCreateObservationCondition,
  useDeleteObservationCondition,
  useObservationConditions,
  useUpdateObservationCondition,
} from "@/hooks/useWatchlists";
import {
  OBSERVATION_CONDITION_TYPES,
  type ObservationCondition,
  type ObservationConditionCreateInput,
  type ObservationConditionSeverity,
  type ObservationConditionType,
} from "@/services/observationConditionService";
import type { WatchlistItem } from "@/services/watchlistService";

import { conditionSummary, conditionTypeLabel } from "./watchlist-format";

type RuleForm = {
  conditionType: ObservationConditionType;
  threshold: string;
  thresholdDate: string;
  windowDays: string;
  severity: ObservationConditionSeverity;
};

const emptyRule: RuleForm = {
  conditionType: "PRICE_BELOW",
  threshold: "",
  thresholdDate: "",
  windowDays: "20",
  severity: "ATTENTION",
};

const severityLabels: Record<ObservationConditionSeverity, string> = {
  INFORMATION: "信息",
  ATTENTION: "关注",
  IMPORTANT: "重要",
  URGENT: "紧急",
};

export function ConditionSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  watchlistId: string | null;
  item: WatchlistItem | null;
}) {
  const itemId = props.item?.id ?? null;
  const conditions = useObservationConditions(itemId);
  const context = { watchlistId: props.watchlistId, itemId };
  const createMutation = useCreateObservationCondition(context);
  const updateMutation = useUpdateObservationCondition(context);
  const deleteMutation = useDeleteObservationCondition(context);
  const [editing, setEditing] = useState<ObservationCondition | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyRule);
  const saving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!props.open) {
      setFormOpen(false);
      setEditing(null);
      setForm(emptyRule);
    }
  }, [props.open]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyRule);
    setFormOpen(true);
  };

  const openEdit = (condition: ObservationCondition) => {
    setEditing(condition);
    setForm({
      conditionType: condition.conditionType,
      threshold: ratioRule(condition.conditionType)
        ? String(Number(condition.threshold) * 100)
        : condition.threshold,
      thresholdDate: condition.thresholdDate ?? "",
      windowDays: String(condition.windowDays ?? 20),
      severity: condition.severity,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!itemId) return;
    try {
      if (editing) {
        await updateMutation.mutateAsync({
          condition: editing,
          patch: patchFor(form),
        });
        toast.success("提醒规则已更新");
      } else {
        await createMutation.mutateAsync(createInput(itemId, form));
        toast.success("提醒规则已创建");
      }
      setFormOpen(false);
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "规则保存失败");
    }
  };

  const toggle = async (condition: ObservationCondition) => {
    try {
      await updateMutation.mutateAsync({
        condition,
        patch: { status: condition.status === "ACTIVE" ? "PAUSED" : "ACTIVE" },
      });
      toast.success(condition.status === "ACTIVE" ? "规则已暂停" : "规则已启用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "规则状态更新失败");
    }
  };

  const remove = async (condition: ObservationCondition) => {
    try {
      await deleteMutation.mutateAsync(condition);
      toast.success("规则已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "规则删除失败");
    }
  };

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="watchlist-condition-sheet w-full sm:max-w-xl"
        aria-label={`${props.item?.name ?? "观察对象"}提醒规则`}
      >
        <SheetHeader>
          <SheetTitle>{props.item?.name ?? "观察对象"}提醒规则</SheetTitle>
          <SheetDescription>管理价格、回撤、单日异动、持仓权重、浮盈和复查日期规则。</SheetDescription>
        </SheetHeader>

        <div className="condition-sheet-body">
          <div className="condition-sheet-toolbar">
            <span>{conditions.data?.length ?? 0} 条规则</span>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="size-4" />新建规则
            </Button>
          </div>

          {formOpen ? (
            <div className="condition-editor">
              <div className="space-y-2">
                <Label>规则类型</Label>
                <Select
                  value={form.conditionType}
                  onValueChange={(conditionType) => setForm((current) => ({
                    ...current,
                    conditionType: conditionType as ObservationConditionType,
                  }))}
                  disabled={Boolean(editing)}
                >
                  <SelectTrigger aria-label="规则类型"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OBSERVATION_CONDITION_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{conditionTypeLabel(type)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.conditionType === "REVIEW_DATE" ? (
                <div className="space-y-2">
                  <Label htmlFor="condition-date">复查日期</Label>
                  <Input
                    id="condition-date"
                    type="date"
                    value={form.thresholdDate}
                    onChange={(event) => setForm((current) => ({ ...current, thresholdDate: event.target.value }))}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="condition-threshold">{thresholdLabel(form.conditionType)}</Label>
                  <Input
                    id="condition-threshold"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.threshold}
                    onChange={(event) => setForm((current) => ({ ...current, threshold: event.target.value }))}
                  />
                </div>
              )}

              {form.conditionType === "DRAWDOWN_REACH" ? (
                <div className="space-y-2">
                  <Label htmlFor="condition-window">观察窗口（交易日）</Label>
                  <Input
                    id="condition-window"
                    type="number"
                    min="5"
                    max="120"
                    value={form.windowDays}
                    onChange={(event) => setForm((current) => ({ ...current, windowDays: event.target.value }))}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>严重度</Label>
                <Select
                  value={form.severity}
                  onValueChange={(severity) => setForm((current) => ({
                    ...current,
                    severity: severity as ObservationConditionSeverity,
                  }))}
                >
                  <SelectTrigger aria-label="严重度"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(severityLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="condition-editor-actions">
                <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>取消</Button>
                <Button type="button" onClick={() => void save()} disabled={saving}>
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  保存规则
                </Button>
              </div>
            </div>
          ) : null}

          <div className="condition-list">
            {conditions.isLoading ? <div className="state-panel">正在读取规则</div> : null}
            {!conditions.isLoading && !conditions.data?.length ? (
              <div className="state-panel">还没有规则，可从价格或复查日期开始。</div>
            ) : null}
            {conditions.data?.map((condition) => (
              <div key={condition.id} className="condition-row">
                <span>{conditionSummary(condition)}</span>
                <span className={condition.status === "ACTIVE" ? "is-active" : "is-paused"}>
                  {condition.status === "ACTIVE" ? "已启用" : "已暂停"}
                </span>
                <small>{severityLabels[condition.severity]} · 最近检查 {condition.lastEvaluatedAt ?? "暂无"}</small>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void toggle(condition)}
                >
                  {condition.status === "ACTIVE" ? "暂停规则" : "启用规则"}
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="编辑规则" onClick={() => openEdit(condition)}>
                  <Pencil className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="删除规则" onClick={() => void remove(condition)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>关闭</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function createInput(itemId: string, form: RuleForm): ObservationConditionCreateInput {
  if (form.conditionType === "REVIEW_DATE") {
    return {
      watchlistItemId: itemId,
      conditionType: "REVIEW_DATE",
      thresholdDate: form.thresholdDate,
      severity: form.severity,
    };
  }
  if (form.conditionType === "DRAWDOWN_REACH") {
    return {
      watchlistItemId: itemId,
      conditionType: "DRAWDOWN_REACH",
      threshold: normalizedThreshold(form),
      windowDays: Number(form.windowDays),
      severity: form.severity,
    };
  }
  return {
    watchlistItemId: itemId,
    conditionType: form.conditionType,
    threshold: normalizedThreshold(form),
    severity: form.severity,
  };
}

function patchFor(form: RuleForm) {
  if (form.conditionType === "REVIEW_DATE") {
    return { thresholdDate: form.thresholdDate, severity: form.severity };
  }
  return {
    threshold: normalizedThreshold(form),
    windowDays: form.conditionType === "DRAWDOWN_REACH" ? Number(form.windowDays) : null,
    severity: form.severity,
  };
}

function normalizedThreshold(form: RuleForm): string {
  const value = Number(form.threshold);
  if (!Number.isFinite(value) || value <= 0) throw new Error("请输入有效阈值");
  return ratioRule(form.conditionType) ? String(value / 100) : String(value);
}

function ratioRule(type: ObservationConditionType): boolean {
  return [
    "DRAWDOWN_REACH",
    "DAILY_MOVE_REACH",
    "POSITION_WEIGHT_ABOVE",
    "UNREALIZED_GAIN_REACH",
  ].includes(type);
}

function thresholdLabel(type: ObservationConditionType): string {
  if (type === "PRICE_ABOVE" || type === "PRICE_BELOW") return "价格阈值";
  return "比例阈值 (%)";
}
