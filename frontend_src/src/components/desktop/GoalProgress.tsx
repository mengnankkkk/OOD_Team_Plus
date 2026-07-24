import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { UserGoal } from "@/types/app/user";
import { Loader } from "@/components/ui/loader";

interface GoalProgressProps {
  goal: UserGoal | null;
  loading?: boolean;
}

const formatCny = (n: number) => `¥${Math.round(n).toLocaleString("zh-CN")}`;

const GoalProgress = ({ goal, loading }: GoalProgressProps) => {
  if (loading) {
    return (
      <section className="paper-card grid min-h-72 place-items-center p-9">
        <Loader label="加载目标档案…" />
      </section>
    );
  }

  if (!goal) {
    return (
      <section className="paper-card flex flex-col items-start p-9">
        <p className="eyebrow">还没有目标</p>
        <h2 className="mt-3 text-2xl font-semibold">先立一个目标，Agent 才有工作的方向</h2>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">目标可以是买房首付、12 个月应急金、孩子的教育金 —— 一句话说出来，顾问会帮你把它拆成月度、年度和总量。</p>
        <Button asChild className="goal-entry-button mt-6">
          <Link to="/profile">
            <span>去我的页登记目标</span>
            <svg className="goal-entry-button-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 74 74" aria-hidden="true">
              <circle strokeWidth={3} stroke="currentColor" r="35.5" cy={37} cx={37} />
              <path fill="currentColor" d="M25 35.5C24.1716 35.5 23.5 36.1716 23.5 37C23.5 37.8284 24.1716 38.5 25 38.5V35.5ZM49.0607 38.0607C49.6464 37.4749 49.6464 36.5251 49.0607 35.9393L39.5147 26.3934C38.9289 25.8076 37.9792 25.8076 37.3934 26.3934C36.8076 26.9792 36.8076 27.9289 37.3934 28.5147L45.8787 37L37.3934 45.4853C36.8076 46.0711 36.8076 47.0208 37.3934 47.6066C37.9792 48.1924 38.9289 48.1924 39.5147 47.6066L49.0607 38.0607ZM25 38.5L48 38.5V35.5L25 35.5V38.5Z" />
            </svg>
          </Link>
        </Button>
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
          <div className="mt-6 h-2 overflow-hidden border border-foreground bg-muted"><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div>
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
