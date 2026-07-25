import type { HealthMetrics as HealthMetricsData } from "@/types/app/asset";
import type { UserProfile } from "@/types/app/user";
import { Loader } from "@/components/ui/loader";
import { getConcentrationInsight } from "@/lib/financialHealth";

interface AssetOverviewPanelProps {
  metrics: HealthMetricsData | null;
  profile: UserProfile | null;
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

const percent = (value: number | null | undefined, fallback = "—") => (
  value === null || value === undefined || Number.isNaN(value) ? fallback : `${Math.round(value * 100)}%`
);

const AssetOverviewPanel = ({ metrics, profile, loading }: AssetOverviewPanelProps) => {
  if (loading) {
    return <section className="paper-card grid min-h-36 place-items-center p-6"><Loader label="加载资产概览…" /></section>;
  }

  if (!metrics || !metrics.allocation.length) {
    return (
      <section className="paper-card p-6">
        <p className="text-sm text-muted-foreground">资产尚未配置，请手工录入或粘贴 CSV，系统会自动帮你分类、算集中度。</p>
      </section>
    );
  }

  const emergencyTarget = profile?.emergencyTargetMonths ?? 6;
  const emergencyValue = metrics.emergencyMonths;
  const savingsRate = metrics.savingsRate;
  const topClassRatio = metrics.concentration.topClassRatio;
  const concentrationInsight = getConcentrationInsight({ concentration: metrics.concentration });
  const drawdown = metrics.drawdown;
  const drawdownAlert = drawdown > 0.2;
  const emergencyAlert = emergencyValue !== null && emergencyValue < emergencyTarget;
  const savingsAlert = savingsRate !== null && savingsRate < 0.15;
  const totalAssets = Math.round(metrics.totalAssets).toLocaleString("zh-CN");

  const cards = [
    {
      label: "应急金覆盖",
      value: emergencyValue === null ? "—" : `${emergencyValue.toFixed(1)} 月`,
      note: emergencyValue === null ? "登记支出后计算" : `目标 ${emergencyTarget} 个月`,
      alert: emergencyAlert,
    },
    {
      label: "储蓄率",
      value: percent(savingsRate),
      note: savingsRate === null ? "登记月收入与支出即可" : savingsRate < 0.15 ? "偏低" : "现金流健康",
      alert: savingsAlert,
    },
    {
      label: concentrationInsight.label,
      value: percent(topClassRatio),
      note: concentrationInsight.note,
      alert: false,
    },
    {
      label: "组合估算最大回撤",
      value: `-${Math.round(drawdown * 100)}%`,
      note: drawdownAlert ? "已触发关注线" : "波动可控",
      alert: drawdownAlert,
    },
  ];

  return (
    <section className="paper-card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6">
        <div>
          <p className="eyebrow">资产概览</p>
          <h2 className="mt-2 text-lg font-semibold">{drawdownAlert ? "当前资产需要关注" : "当前资产配置可控"}</h2>
        </div>
        <span className="rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground">¥{totalAssets}</span>
      </div>

      <div className="grid gap-px bg-foreground md:grid-cols-4">
        {cards.map((metric) => (
          <article key={metric.label} className="relative bg-card p-5">
            {metric.alert ? <span className="status-led" /> : null}
            <p className="eyebrow pr-6">{metric.label}</p>
            <p className={`mt-4 font-mono text-3xl font-semibold tabular-nums ${metric.alert ? "text-destructive" : "text-foreground"}`}>{metric.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{metric.note}</p>
          </article>
        ))}
      </div>

      <div className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div><p className="eyebrow">资产配置</p><h3 className="mt-2 text-base font-semibold">{metrics.allocation.length} 类资产</h3></div>
          <span className="text-xs text-muted-foreground">按当前市值计算</span>
        </div>
        <div className="mt-5 flex h-5 overflow-hidden border border-foreground">
          {metrics.allocation.map((item) => <div key={item.assetClass} className={CLASS_COLOR[item.assetClass] ?? "bg-muted"} style={{ width: `${Math.max(item.ratio * 100, 0.5)}%` }} />)}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.allocation.slice(0, 4).map((item) => (
            <div key={item.assetClass} className="border border-border p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 font-mono text-xl font-semibold">{Math.round(item.ratio * 100)}%</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AssetOverviewPanel;
