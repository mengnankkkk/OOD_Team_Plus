import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useUserGoals, useUserGoalsInvalidator } from "@/hooks/useUserGoals";
import { createGoal, deleteGoal, updateGoal } from "@/services/goalService";
import { toast } from "sonner";
import { Flag, Pencil, Plus, Target, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserGoal } from "@/types/app/user";

type GoalCategory = UserGoal["category"];

const CATEGORY_META: Record<GoalCategory, { label: string; hint: string; tone: string }> = {
  house: { label: "购房", hint: "首付 / 换房 / 装修资金", tone: "text-primary bg-primary/10" },
  emergency: { label: "应急金", hint: "覆盖 3-12 个月必要支出", tone: "text-[hsl(var(--status-watch))] bg-[hsl(var(--status-watch))]/10" },
  education: { label: "教育金", hint: "孩子学费 / 自我进修", tone: "text-[hsl(var(--status-down))] bg-[hsl(var(--status-down))]/10" },
  retirement: { label: "养老", hint: "退休后的现金流", tone: "text-primary bg-primary/10" },
  custom: { label: "自定义", hint: "旅行、创业、大额消费等", tone: "text-muted-foreground bg-muted" },
};

const PRIORITY_OPTIONS = [
  { value: 1, label: "1 · 最高优先" },
  { value: 2, label: "2 · 高" },
  { value: 3, label: "3 · 中" },
  { value: 4, label: "4 · 低" },
  { value: 5, label: "5 · 观察" },
];

interface GoalFormState {
  name: string;
  category: GoalCategory;
  targetAmount: string;
  currentAmount: string;
  targetDate: string;
  priority: number;
  monthlyContribution: string;
}

const emptyForm: GoalFormState = {
  name: "",
  category: "custom",
  targetAmount: "",
  currentAmount: "0",
  targetDate: "",
  priority: 3,
  monthlyContribution: "",
};

const formatMoney = (n: number) => `¥${Math.round(n).toLocaleString()}`;

const monthsBetween = (target: string | null): number | null => {
  if (!target) return null;
  const t = new Date(target).getTime();
  if (Number.isNaN(t)) return null;
  const diff = (t - Date.now()) / (1000 * 60 * 60 * 24 * 30);
  return Math.round(diff);
};

const suggestedMonthly = (goal: { targetAmount: number; currentAmount: number; targetDate: string | null; monthlyContribution: number | null }): number | null => {
  if (goal.monthlyContribution) return goal.monthlyContribution;
  const gap = Math.max(goal.targetAmount - goal.currentAmount, 0);
  const months = monthsBetween(goal.targetDate);
  if (!months || months <= 0 || gap <= 0) return null;
  return Math.round(gap / months);
};

const GoalsPage = () => {
  const { user, isAnonymous } = useAuth();
  const { data: goals = [], isLoading } = useUserGoals();
  const invalidate = useUserGoalsInvalidator();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<UserGoal | null>(null);

  const summary = useMemo(() => {
    const total = goals.reduce((s, g) => s + (g.targetAmount || 0), 0);
    const reserved = goals.reduce((s, g) => s + (g.currentAmount || 0), 0);
    const gap = Math.max(total - reserved, 0);
    return { total, reserved, gap };
  }, [goals]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (goal: UserGoal) => {
    setEditingId(goal.id);
    setForm({
      name: goal.name,
      category: goal.category,
      targetAmount: String(goal.targetAmount ?? ""),
      currentAmount: String(goal.currentAmount ?? "0"),
      targetDate: goal.targetDate ?? "",
      priority: goal.priority ?? 3,
      monthlyContribution: goal.monthlyContribution !== null ? String(goal.monthlyContribution) : "",
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.name.trim()) { toast.error("请填写目标名称"); return; }
    const target = Number(form.targetAmount);
    if (!target || target <= 0) { toast.error("请填写有效的目标金额"); return; }
    const current = Number(form.currentAmount) || 0;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        targetAmount: target,
        currentAmount: current,
        targetDate: form.targetDate || null,
        priority: Number(form.priority) || 3,
        monthlyContribution: form.monthlyContribution ? Number(form.monthlyContribution) : null,
        successProbability: null,
      };
      if (editingId) {
        await updateGoal(user.id, editingId, payload);
        toast.success("目标已更新");
      } else {
        await createGoal(user.id, payload);
        toast.success("新目标已加入档案");
      }
      invalidate();
      setFormOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !pendingDelete) return;
    try {
      await deleteGoal(user.id, pendingDelete.id);
      toast.success(`已删除目标「${pendingDelete.name}」`);
      invalidate();
      setPendingDelete(null);
    } catch (err: any) {
      toast.error(err?.message ?? "删除失败");
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">我的</p>
          <h1 className="mt-2 text-3xl font-semibold">我的个人目标档案</h1>
          <p className="mt-2 text-sm text-muted-foreground">你的目标不设数量上限。每一条都可以修改、删除，AI Agent 生成建议时会以这里的目标为准。</p>
        </div>
        <Button onClick={openCreate} className="h-11 rounded-sm px-5"><Plus className="size-4" />新建目标</Button>
      </div>

      <section className="paper-card mb-6 p-5">
        <div className="grid gap-5 text-sm md:grid-cols-4">
          <div>
            <p className="eyebrow">目标总数</p>
            <p className="mt-1 font-mono text-2xl">{goals.length}</p>
          </div>
          <div>
            <p className="eyebrow">目标金额合计</p>
            <p className="mt-1 font-mono text-2xl">{formatMoney(summary.total)}</p>
          </div>
          <div>
            <p className="eyebrow">已备金额合计</p>
            <p className="mt-1 font-mono text-2xl">{formatMoney(summary.reserved)}</p>
          </div>
          <div>
            <p className="eyebrow">资产缺口合计</p>
            <p className={cn("mt-1 font-mono text-2xl", summary.gap > 0 ? "text-destructive" : "text-[hsl(var(--status-down))]")}>{formatMoney(summary.gap)}</p>
          </div>
        </div>
        {isAnonymous && (
          <p className="mt-4 text-xs text-muted-foreground">游客模式：目标档案保存在你的匿名账号下；绑定邮箱后可跨设备继续使用。</p>
        )}
      </section>

      {isLoading ? (
        <div className="grid place-items-center rounded-md border border-dashed border-border py-16 text-muted-foreground">正在加载目标档案…</div>
      ) : goals.length === 0 ? (
        <div className="grid place-items-center rounded-md border border-dashed border-border py-16 text-center">
          <div>
            <Target className="mx-auto size-8 text-primary" />
            <p className="mt-3 text-base font-medium">还没有目标</p>
            <p className="mt-1 text-sm text-muted-foreground">从"三年买房""半年应急金""孩子五年后的教育金"这些具体目标开始，Agent 才能真正为你打算。</p>
            <Button onClick={openCreate} className="mt-5 rounded-sm"><Plus className="size-4" />添加第一个目标</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((goal) => {
            const meta = CATEGORY_META[goal.category];
            const gap = Math.max(goal.targetAmount - goal.currentAmount, 0);
            const progress = goal.targetAmount > 0 ? Math.min(1, goal.currentAmount / goal.targetAmount) : 0;
            const months = monthsBetween(goal.targetDate);
            const suggested = suggestedMonthly(goal);
            return (
              <article key={goal.id} className="paper-card flex flex-col gap-4 p-5">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-medium", meta.tone)}>
                        <Flag className="size-3" />{meta.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">优先级 P{goal.priority}</span>
                    </div>
                    <h2 className="mt-1.5 truncate text-lg font-semibold">{goal.name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta.hint}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(goal)} aria-label="编辑目标"><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setPendingDelete(goal)} aria-label="删除目标" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>
                  </div>
                </header>

                <div>
                  <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                    <span>已备 {formatMoney(goal.currentAmount)}</span>
                    <span>目标 {formatMoney(goal.targetAmount)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">完成度 {(progress * 100).toFixed(1)}%</p>
                </div>

                <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-background/60 p-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">资产缺口</dt>
                    <dd className={cn("mt-0.5 font-mono text-base", gap > 0 ? "text-destructive" : "text-[hsl(var(--status-down))]")}>{formatMoney(gap)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">目标日期</dt>
                    <dd className="mt-0.5 font-mono text-base">{goal.targetDate ? new Date(goal.targetDate).toLocaleDateString("zh-CN") : "未设定"}</dd>
                    {months !== null && <p className="mt-0.5 text-[10px] text-muted-foreground">{months > 0 ? `还剩 ${months} 个月` : months < 0 ? `已过 ${-months} 个月` : "本月到期"}</p>}
                  </div>
                  <div>
                    <dt className="text-muted-foreground flex items-center gap-1"><Wallet className="size-3" />月度供款</dt>
                    <dd className="mt-0.5 font-mono text-base">{goal.monthlyContribution ? formatMoney(goal.monthlyContribution) : "—"}</dd>
                    {!goal.monthlyContribution && suggested !== null && <p className="mt-0.5 text-[10px] text-muted-foreground">按期完成需 ≈ {formatMoney(suggested)}/月</p>}
                  </div>
                  <div>
                    <dt className="text-muted-foreground">成功概率</dt>
                    <dd className="mt-0.5 font-mono text-base">{goal.successProbability !== null ? `${Math.round(goal.successProbability * 100)}%` : "待 Agent 评估"}</dd>
                  </div>
                </dl>

                <footer className="text-[10px] text-muted-foreground">
                  创建于 {new Date(goal.createdAt).toLocaleDateString("zh-CN")} · 最近更新 {new Date(goal.updatedAt).toLocaleDateString("zh-CN")}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑目标" : "新建目标"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>目标名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：三年后在杭州付首付" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>目标类型</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as GoalCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(CATEGORY_META) as GoalCategory[]).map((c) => <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>优先级</Label>
                <Select value={String(form.priority)} onValueChange={(v) => setForm({ ...form, priority: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITY_OPTIONS.map((p) => <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>目标金额（元）</Label>
                <Input type="number" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} placeholder="例如 600000" />
              </div>
              <div className="space-y-2">
                <Label>已备金额（元）</Label>
                <Input type="number" value={form.currentAmount} onChange={(e) => setForm({ ...form, currentAmount: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>目标日期</Label>
                <Input type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>建议月度供款（元，可留空）</Label>
                <Input type="number" value={form.monthlyContribution} onChange={(e) => setForm({ ...form, monthlyContribution: e.target.value })} placeholder="留空则按剩余缺口自动估算" />
              </div>
            </div>

            {(() => {
              const t = Number(form.targetAmount) || 0;
              const c = Number(form.currentAmount) || 0;
              const g = Math.max(t - c, 0);
              return (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                  <p className="text-muted-foreground">保存后可自动计算：</p>
                  <p className="mt-1 font-mono">资产缺口 · <span className={cn(g > 0 ? "text-destructive" : "text-[hsl(var(--status-down))]")}>{formatMoney(g)}</span></p>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "保存中…" : editingId ? "保存修改" : "加入档案"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除目标？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.name}」将从你的目标档案中移除，与之关联的资产归属会解绑，但已有的建议与决策日志不会删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">删除目标</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GoalsPage;
