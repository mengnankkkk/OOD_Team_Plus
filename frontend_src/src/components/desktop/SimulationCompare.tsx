interface SimulationCompareProps {
  before: any;
  after: any;
  action: string;
}

const fields: { key: string; label: string; format: (v: number) => string; better: "lower" | "higher" }[] = [
  { key: "concentration", label: "单类资产集中度", format: (v) => `${(v * 100).toFixed(1)}%`, better: "lower" },
  { key: "drawdown", label: "组合估算最大回撤", format: (v) => `-${(v * 100).toFixed(1)}%`, better: "lower" },
  { key: "emergency_months", label: "应急金覆盖", format: (v) => `${v.toFixed(1)} 月`, better: "higher" },
];

const SimulationCompare = ({ before, after }: SimulationCompareProps) => {
  if (!before || !after) return <p className="text-sm text-muted-foreground">模拟数据缺失</p>;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {fields.map((f) => {
        const bv = before[f.key];
        const av = after[f.key];
        if (bv === null || bv === undefined || av === null || av === undefined) return null;
        const delta = av - bv;
        const isImprovement = f.better === "lower" ? delta < 0 : delta > 0;
        return (
          <div key={f.key} className="rounded-md border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{f.label}</p>
            <div className="mt-3 flex items-baseline gap-3 font-mono">
              <span className="text-lg text-muted-foreground line-through">{f.format(Number(bv))}</span>
              <span className="text-xl font-semibold">{f.format(Number(av))}</span>
            </div>
            <p className={`mt-2 text-xs ${isImprovement ? "text-[hsl(var(--status-down))]" : "text-destructive"}`}>{isImprovement ? "预期改善" : "反向变化"}</p>
          </div>
        );
      })}
      <p className="col-span-full mt-3 text-xs text-muted-foreground">模拟采纳只会在演示账本上落章；真实资产不会变化。</p>
    </div>
  );
};

export default SimulationCompare;
