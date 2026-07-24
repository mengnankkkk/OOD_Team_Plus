import type { HealthMetrics as HealthMetricsData } from "@/types/app/asset";
import { ASSET_CLASS_LABEL } from "@/types/app/asset";
import type { UserProfile } from "@/types/app/user";

interface HealthMetricsProps {
  metrics: HealthMetricsData | null;
  profile: UserProfile | null;
  loading?: boolean;
}

const percent = (v: number | null | undefined, fallback = "—") => (v === null || v === undefined || Number.isNaN(v) ? fallback : `${Math.round(v * 100)}%`);

const HealthMetrics = ({ metrics, profile, loading }: HealthMetricsProps) => {
  const emergencyTarget = profile?.emergencyTargetMonths ?? 6;

  const emergencyValue = metrics?.emergencyMonths ?? null;
  const emergencyAlert = emergencyValue !== null && emergencyValue < emergencyTarget;

  const topClassRatio = metrics?.concentration.topClassRatio ?? 0;
  const concentrationAlert = topClassRatio > 0.4;
  const topClassLabel = metrics?.concentration.topClass ? ASSET_CLASS_LABEL[metrics.concentration.topClass] : "—";

  const savingsRate = metrics?.savingsRate ?? null;
  const drawdown = metrics?.drawdown ?? null;

  const cards = [
    {
      label: "应急金覆盖",
      value: emergencyValue === null ? "—" : `${emergencyValue.toFixed(1)} 月`,
      note: emergencyValue === null ? "登记收入与现金资产后自动计算" : `目标 ${emergencyTarget} 个月`,
      alert: emergencyAlert,
    },
    {
      label: "储蓄率",
      value: percent(savingsRate),
      note: savingsRate === null ? "登记月收入与支出即可" : savingsRate < 0.15 ? "偏低，建议压缩非必要支出" : "现金流健康",
      alert: savingsRate !== null && savingsRate < 0.15,
    },
    {
      label: `${topClassLabel}集中度`,
      value: percent(topClassRatio),
      note: concentrationAlert ? `超过 40% 上限 ${Math.round((topClassRatio - 0.4) * 100)}%` : "在你的风险预算内",
      alert: concentrationAlert,
    },
    {
      label: "组合估算最大回撤",
      value: drawdown === null ? "—" : `-${Math.round(drawdown * 100)}%`,
      note: drawdown !== null && drawdown > 0.2 ? "已触发关注线" : "波动可控",
      alert: drawdown !== null && drawdown > 0.2,
    },
  ];

  if (loading) {
    return (
      <section className="grid h-full grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse bg-card p-5"><div className="h-3 w-20 rounded bg-muted" /><div className="mt-6 h-8 w-24 rounded bg-muted" /></div>
        ))}
      </section>
    );
  }

  return (
    <section className="grid h-full grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {cards.map((metric) => (
        <article key={metric.label} className="relative bg-card p-5 md:p-6">
          {metric.alert && <span className="status-led" />}
          <p className="eyebrow pr-6">{metric.label}</p>
          <p className={`mt-4 font-mono text-3xl font-semibold tabular-nums ${metric.alert ? "text-destructive" : "text-foreground"}`}>{metric.value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{metric.note}</p>
        </article>
      ))}
    </section>
  );
};

export default HealthMetrics;
