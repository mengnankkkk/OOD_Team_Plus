import type { HealthMetrics } from "@/types/app/asset";
import { Loader } from "@/components/ui/loader";

interface DrawdownChartProps {
  metrics: HealthMetrics | null;
  loading?: boolean;
}

const DrawdownChart = ({ metrics, loading }: DrawdownChartProps) => {
  const drawdown = metrics?.drawdown ?? null;
  if (loading) {
    return <section className="paper-card grid min-h-48 place-items-center p-6"><Loader label="加载回撤图表…" /></section>;
  }
  const dd = drawdown ?? 0;
  const alert = dd > 0.2;

  return (
    <section className="paper-card p-6">
      <div className="flex items-center justify-between">
        <div><p className="eyebrow">风险温度 · 组合估算回撤</p><h2 className="mt-2 text-lg font-semibold">{alert ? "已触发关注线" : "整体波动可控"}</h2></div>
        <span className={`font-mono text-sm ${alert ? "text-destructive" : "text-muted-foreground"}`}>{drawdown === null ? "—" : `-${Math.round(dd * 100)}%`}</span>
      </div>
      <div className="relative mt-6 h-36 overflow-hidden border border-foreground bg-[radial-gradient(#111111_1px,transparent_1px)] [background-size:16px_16px]">
        <svg viewBox="0 0 600 150" className="h-full w-full" role="img" aria-label="组合估算回撤走势">
          <defs>
            <linearGradient id="dd-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity="0.28" />
              <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`M0 ${30 - dd * 60} C90 ${30 - dd * 40} 180 ${60 + dd * 20} 300 ${70 + dd * 40} S480 ${110 + dd * 30} 600 ${100 + dd * 40} L600 150 L0 150 Z`} fill="url(#dd-fill)" />
          <path d={`M0 ${30 - dd * 60} C90 ${30 - dd * 40} 180 ${60 + dd * 20} 300 ${70 + dd * 40} S480 ${110 + dd * 30} 600 ${100 + dd * 40}`} className="fill-none stroke-destructive stroke-[3]" />
          <line x1="0" y1="100" x2="600" y2="100" className="stroke-border" strokeDasharray="6 6" />
          {alert && <circle cx="440" cy={100 + dd * 20} r="7" className="fill-destructive pulse-point" />}
        </svg>
        {alert && <span className="absolute bottom-4 right-6 border border-foreground bg-card px-2 py-1 text-[11px]">集中度警报触发</span>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">按当前持仓与资产类别历史特征估算的组合回撤上限，并非未来预测。</p>
    </section>
  );
};

export default DrawdownChart;
