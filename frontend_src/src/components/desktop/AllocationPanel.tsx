import type { HealthMetrics } from "@/types/app/asset";
import { Loader } from "@/components/ui/loader";

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
  if (!allocation.length) {
    return (
      <section className="paper-card p-6">
        <p className="eyebrow">资产配置</p>
        <h2 className="mt-2 text-lg font-semibold">还没有持仓</h2>
        <p className="mt-3 text-sm text-muted-foreground">去<a className="text-primary underline underline-offset-4" href="/assets">资产页</a>手工录入或粘贴 CSV，系统会自动帮你分类、算集中度。</p>
      </section>
    );
  }
  const topClassRatio = metrics?.concentration.topClassRatio ?? 0;
  const alert = topClassRatio > 0.4;

  return (
    <section className="paper-card p-6">
      <div className="flex items-center justify-between">
        <div><p className="eyebrow">资产配置</p><h2 className="mt-2 text-lg font-semibold">{alert ? "风险集中在单一赛道" : "配置比例概览"}</h2></div>
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
      {alert && (
        <div className="mt-6 border border-destructive border-l-4 bg-destructive/5 px-4 py-3 text-sm">
          <strong>同一动因：</strong>{metrics?.concentration.topClass && `${allocation[0]?.label}` } 集中度 {Math.round(topClassRatio * 100)}%，超过 40% 上限。
        </div>
      )}
    </section>
  );
};

export default AllocationPanel;
