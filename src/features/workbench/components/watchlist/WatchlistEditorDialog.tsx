import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import AShareInstrumentPicker, {
  type InstrumentSearchResult,
} from "@/components/desktop/AShareInstrumentPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateWatchlistItem,
  useUpdateWatchlistItem,
} from "@/hooks/useWatchlists";
import { resolveWatchlistInstrument, type WatchlistItem } from "@/services/watchlistService";
import type { UserGoal } from "@/types/app/user";

type FormState = {
  name: string;
  symbol: string;
  reason: string;
  plannedHorizon: string;
  goalId: string;
  thresholdEnabled: boolean;
  threshold: string;
};

const emptyForm: FormState = {
  name: "",
  symbol: "",
  reason: "",
  plannedHorizon: "",
  goalId: "__none__",
  thresholdEnabled: true,
  threshold: "15",
};

export function WatchlistEditorDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  watchlistId: string | null;
  item: WatchlistItem | null;
  goals: UserGoal[];
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentSearchResult | null>(null);
  const createMutation = useCreateWatchlistItem(props.watchlistId);
  const updateMutation = useUpdateWatchlistItem(props.watchlistId);
  const editing = Boolean(props.item);
  const saving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!props.open) return;
    if (props.item) {
      setForm({
        name: props.item.name,
        symbol: props.item.symbol,
        reason: props.item.reason ?? "",
        plannedHorizon: props.item.plannedHorizon ?? "",
        goalId: props.item.goal?.id ?? "__none__",
        thresholdEnabled: false,
        threshold: "15",
      });
      setSelectedInstrument(null);
    } else {
      setForm(emptyForm);
      setSelectedInstrument(null);
    }
  }, [props.item, props.open]);

  const save = async () => {
    try {
      if (props.item) {
        await updateMutation.mutateAsync({
          item: props.item,
          patch: {
            reason: nullable(form.reason),
            plannedHorizon: nullable(form.plannedHorizon),
            goalId: form.goalId === "__none__" ? null : form.goalId,
          },
        });
        toast.success("观察信息已更新");
      } else {
        if (!form.name.trim() || !form.symbol.trim()) {
          toast.error("请选择一个可交易标的");
          return;
        }
        const threshold = Number(form.threshold);
        if (form.thresholdEnabled && (!Number.isFinite(threshold) || threshold < 1 || threshold > 90)) {
          toast.error("初始回撤阈值需在 1% 到 90% 之间");
          return;
        }
        const instrument = await resolveWatchlistInstrument({
          symbol: form.symbol,
          name: form.name,
          market: selectedInstrument?.market,
          assetType: normalizeAssetType(selectedInstrument?.assetType),
          sector: selectedInstrument?.sector ?? undefined,
        });
        await createMutation.mutateAsync({
          instrumentId: instrument.instrumentId,
          reason: nullable(form.reason) ?? undefined,
          plannedHorizon: nullable(form.plannedHorizon) ?? undefined,
          goalId: form.goalId === "__none__" ? null : form.goalId,
          initialDrawdownThresholdPct: form.thresholdEnabled ? threshold : null,
        });
        toast.success("已加入持仓观测");
      }
      props.onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="watchlist-editor-dialog max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑观察对象" : "添加观察对象"}</DialogTitle>
          <DialogDescription>
            {editing ? "更新关注理由、计划期限和目标关联。" : "选择标的并写清楚观察原因，规则可在保存后继续扩展。"}
          </DialogDescription>
        </DialogHeader>

        <div className="watchlist-form-grid">
          {!editing ? (
            <AShareInstrumentPicker
              idPrefix="watchlist-editor"
              name={form.name}
              symbol={form.symbol}
              onChange={(next) => {
                setForm((current) => ({ ...current, name: next.name, symbol: next.symbol }));
                setSelectedInstrument(next.stock);
              }}
            />
          ) : (
            <div className="watchlist-editor-instrument">
              <span>观察标的</span>
              <strong>{props.item?.name}</strong>
              <small>{props.item?.symbol}</small>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="watchlist-reason">关注理由</Label>
            <Textarea
              id="watchlist-reason"
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="为什么值得持续观察？什么变化会改变你的判断？"
              maxLength={500}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="watchlist-horizon">计划期限</Label>
              <Input
                id="watchlist-horizon"
                value={form.plannedHorizon}
                onChange={(event) => setForm((current) => ({ ...current, plannedHorizon: event.target.value }))}
                placeholder="例如 3-5 年"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label>关联目标</Label>
              <Select
                value={form.goalId}
                onValueChange={(goalId) => setForm((current) => ({ ...current, goalId }))}
              >
                <SelectTrigger aria-label="关联目标">
                  <SelectValue placeholder="选择目标" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未关联目标</SelectItem>
                  {props.goals.map((goal) => (
                    <SelectItem key={goal.id} value={goal.id}>{goal.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!editing ? (
            <div className="watchlist-initial-rule">
              <div>
                <Label htmlFor="watchlist-threshold-switch">创建初始回撤规则</Label>
                <p>保存时建立一条近 20 个交易日回撤提醒。</p>
              </div>
              <Switch
                id="watchlist-threshold-switch"
                checked={form.thresholdEnabled}
                onCheckedChange={(thresholdEnabled) => setForm((current) => ({ ...current, thresholdEnabled }))}
                aria-label="创建初始回撤规则"
              />
              {form.thresholdEnabled ? (
                <div className="space-y-2">
                  <Label htmlFor="watchlist-threshold">初始回撤阈值 (%)</Label>
                  <Input
                    id="watchlist-threshold"
                    type="number"
                    min="1"
                    max="90"
                    step="0.1"
                    value={form.threshold}
                    onChange={(event) => setForm((current) => ({ ...current, threshold: event.target.value }))}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>取消</Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {editing ? "保存修改" : "保存观察对象"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAssetType(value: string | undefined): "stock" | "fund" | "index" | "bond" | "cash" | "other" {
  const normalized = value?.toLowerCase();
  if (normalized === "stock" || normalized === "fund" || normalized === "index"
    || normalized === "bond" || normalized === "cash") return normalized;
  return "other";
}
