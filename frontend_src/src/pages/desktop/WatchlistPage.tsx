import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUserGoals } from "@/hooks/useUserGoals";
import { sb } from "@/services/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, Trash2, Eye } from "lucide-react";

const WatchlistPage = () => {
  const { user } = useAuth();
  const { data: goals = [] } = useUserGoals();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [reason, setReason] = useState("");
  const [threshold, setThreshold] = useState("15");
  const [goalId, setGoalId] = useState<string>("__none__");
  const [horizon, setHorizon] = useState("");

  const { data: watchlist = [], isLoading } = useQuery({
    queryKey: ["watchlist", user?.id],
    queryFn: async () => {
      const { data, error } = await sb.from("watchlist").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }).range(0, 49);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const handleAdd = async () => {
    if (!user || !name.trim()) return;
    try {
      await sb.from("watchlist").insert({
        user_id: user.id,
        name: name.trim(),
        symbol: symbol.trim() || name.trim(),
        reason: reason || null,
        planned_horizon: horizon || null,
        drawdown_threshold: threshold ? Number(threshold) : null,
        goal_id: goalId === "__none__" ? null : goalId,
      });
      toast.success("已加入持仓观测");
      setOpen(false); setName(""); setSymbol(""); setReason(""); setThreshold("15"); setHorizon(""); setGoalId("__none__");
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    } catch (err: any) {
      toast.error(err?.message ?? "保存失败");
    }
  };

  const handleDelete = async (id: string, itemName: string) => {
    if (!user) return;
    if (!confirm(`从持仓观测中移除「${itemName}」？`)) return;
    await sb.from("watchlist").delete().eq("user_id", user.id).eq("id", id);
    toast.success("已移除");
    qc.invalidateQueries({ queryKey: ["watchlist"] });
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">持仓观测</p>
          <h1 className="mt-2 text-3xl font-semibold">围绕目标观察，而不是围绕涨跌焦虑</h1>
          <p className="mt-2 text-sm text-muted-foreground">给每个持仓观测对象写清楚"为什么关注"和"什么时候需要动作"，Agent 就能在合适的时候通知你。</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="rounded-sm"><PlusCircle className="size-4" />加入持仓观测</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>加入观察名单</DialogTitle></DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2 md:grid-cols-[1fr_140px]">
                <div className="space-y-2"><Label>标的名称</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="沪深300ETF" /></div>
                <div className="space-y-2"><Label>代码</Label><Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="510300" /></div>
              </div>
              <div className="space-y-2"><Label>关注理由</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="宽基分散，估值处于历史低位" /></div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-2"><Label>计划持有期限</Label><Input value={horizon} onChange={(e) => setHorizon(e.target.value)} placeholder="3-5 年" /></div>
                <div className="space-y-2"><Label>回撤阈值 (%)</Label><Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="15" /></div>
              </div>
              <div className="space-y-2"><Label>关联目标</Label>
                <Select value={goalId} onValueChange={setGoalId}>
                  <SelectTrigger><SelectValue placeholder="选择一个目标（可选）" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">未关联</SelectItem>{goals.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button onClick={handleAdd}>加入</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <p className="text-muted-foreground">加载持仓观测…</p> : watchlist.length === 0 ? (
        <div className="paper-card grid place-items-center p-12 text-center text-muted-foreground">
          <Eye className="size-8" />
          <p className="mt-3">持仓观测是研究的取样瓶 · 先添加 3 只观察对象，Agent 会在触发条件成立时提醒你</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {watchlist.map((w: any) => (
            <li key={w.id} className="paper-card p-5">
              <div className="flex items-start justify-between">
                <div><p className="font-semibold">{w.name}</p><p className="mt-0.5 font-mono text-xs text-muted-foreground">{w.symbol}</p></div>
                <button onClick={() => handleDelete(w.id, w.name)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
              </div>
              {w.reason && <p className="mt-4 text-sm text-muted-foreground">{w.reason}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {w.planned_horizon && <span className="rounded border border-border px-2 py-0.5">持有 {w.planned_horizon}</span>}
                {w.drawdown_threshold && <span className="rounded border border-border px-2 py-0.5">回撤 &gt; {w.drawdown_threshold}% 提醒</span>}
              </div>
              <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Agent 将持续关注：估值、事件、组合关联度、行业拥挤度</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WatchlistPage;
