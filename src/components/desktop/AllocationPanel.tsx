import type { HealthMetrics } from "@/types/app/asset";
import { Loader } from "@/components/ui/loader";
import { getConcentrationInsight } from "@/lib/financialHealth";

interface AllocationPanelProps {
  metrics: HealthMetrics | null;
  loading?: boolean;
}

const CLASS_COLOR: Record<string, string> = {
  cash: "bg-muted-foreground",
  money_market: "bg-[hsl(var(--status-watch))]",
  bond_fund: "bg-primary",
  equity_fund: "bg-destructive",
  stock: "bg-destructive/80",
  index_fund: "bg-[hsl(var(--status-down))]",
  other: "bg-secondary",
};

const AllocationPanel = ({ metrics, loading }: AllocationPanelProps) => {
  if (loading) {
    return <section className="paper-card grid min-h-36 place-items-center p-6"><Loader label="加载资产配置…" /></section>;
  }
  const allocation = metrics?.allocation ?? [];
  if (!metrics || !allocation.length) {
    return (
      <section className="paper-card p-6">
        <p className="eyebrow">资产配置</p>
        <h2 className="mt-2 text-lg font-semibold">还没有持仓</h2>
        <p className="mt-3 text-sm text-muted-foreground">去<a className="text-primary underline underline-offset-4" href="/assets">资产页</a>手工录入或粘贴 CSV，系统会自动帮你分类、算集中度。</p>
      </section>
    );
  }
  const insight = getConcentrationInsight({ concentration: metrics.concentration });

  return (
    <section className="paper-card p-6">
      <div className="flex items-center justify-between">
        <div><p className="eyebrow">资产配置</p><h2 className="mt-2 text-lg font-semibold">配置比例概览</h2></div>
        <span className="judge-note">{allocation.length} 类资产</span>
      </div>
      <div className="mt-8 flex h-5 overflow-hidden border border-foreground">
        {allocation.map((a) => <div key={a.assetClass} className={CLASS_COLOR[a.assetClass] ?? "bg-muted"} style={{ width: `${Math.max(a.ratio * 100, 0.5)}%` }} />)}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {allocation.slice(0, 4).map((a) => (
          <div key={a.assetClass}><p className="text-xs text-muted-foreground">{a.label}</p><p className="mt-1 font-mono text-xl font-semibold">{Math.round(a.ratio * 100)}%</p></div>
        ))}
      </div>
      <div className="mt-6 border border-border border-l-4 border-l-primary bg-muted/30 px-4 py-3 text-sm">
        {insight.note}
      </div>
    </section>
  );
};

export default AllocationPanel;
