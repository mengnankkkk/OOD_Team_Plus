import { Target, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { UserGoal } from "@/types/app/user";

interface GoalProgressProps {
  goal: UserGoal | null;
  loading?: boolean;
}

const formatCny = (n: number) => `¥${Math.round(n).toLocaleString("zh-CN")}`;

const GoalProgress = ({ goal, loading }: GoalProgressProps) => {
  if (loading) {
    return (
      <section className="paper-card p-9">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-10 w-56 animate-pulse rounded bg-muted" />
        <div className="mt-8 h-32 animate-pulse rounded bg-muted" />
      </section>
    );
  }

  if (!goal) {
    return (
      <section className="paper-card flex flex-col items-start p-9">
        <p className="eyebrow">还没有目标</p>
        <h2 className="mt-3 text-2xl font-semibold">先立一个目标，Agent 才有工作的方向</h2>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">目标可以是买房首付、12 个月应急金、孩子的教育金 —— 一句话说出来，顾问会帮你把它拆成月度、年度和总量。</p>
        <Button asChild className="mt-6 rounded-sm"><Link to="/profile"><PlusCircle className="size-4" />去我的页登记目标</Link></Button>
      </section>
    );
  }

  const progress = Math.min(100, Math.round((goal.currentAmount / Math.max(goal.targetAmount, 1)) * 100));

  return (
    <section className="paper-card relative overflow-hidden p-7 md:p-9">
      <div className="flex items-start justify-between">
        <div>
          <p className="eyebrow">首要生活目标</p>
          <h1 className="mt-3 text-2xl font-semibold">{goal.name}</h1>
        </div>
        <Target className="size-6 text-primary" />
      </div>
      <div className="mt-9 grid items-end gap-8 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="metric-display">{formatCny(goal.currentAmount)}</p>
          <p className="mt-2 text-sm text-muted-foreground">目标 {formatCny(goal.targetAmount)} · 已完成 {progress}%</p>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="goal-ring" style={{ background: `radial-gradient(circle, hsl(var(--card)) 57%, transparent 59%), conic-gradient(hsl(var(--primary)) 0 ${progress}%, hsl(var(--muted)) ${progress}% 100%)` }} aria-label={`目标完成 ${progress}%`}><span>{progress}%</span></div>
      </div>
      {goal.targetDate && (
        <p className="mt-7 border-l-2 border-[hsl(var(--status-watch))] pl-3 text-sm text-muted-foreground">目标日期 {new Date(goal.targetDate).toLocaleDateString("zh-CN")}{goal.successProbability !== null ? ` · Agent 估算达成概率 ${goal.successProbability}%` : ""}</p>
      )}
    </section>
  );
};

export default GoalProgress;
