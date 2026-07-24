import type { Recommendation } from "@/types/app/recommendation";

interface OutcomeCompareProps {
  before: any;
  after: any;
  rec: Recommendation;
}

const fmt = (v: any) => (v === null || v === undefined ? "—" : typeof v === "number" ? (Math.abs(v) < 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(2)) : String(v));

const OutcomeCompare = ({ before, after, rec }: OutcomeCompareProps) => {
  const scenarios = [
    { key: "adopt", label: "采纳该建议", desc: "按 Agent 推荐节奏执行", tone: "primary", metrics: after },
    { key: "hold", label: "不操作", desc: "保持当前持仓", tone: "muted", metrics: before },
    { key: "alt", label: "替代方案", desc: rec.action === "decrease" ? "只减一半，保留观察" : "分批更慢执行", tone: "watch", metrics: interpolate(before, after) },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {scenarios.map((s) => (
        <article key={s.key} className={`paper-card p-5 ${s.tone === "primary" ? "border-primary/40" : s.tone === "watch" ? "border-[hsl(var(--status-watch))]/40" : ""}`}>
          <p className="eyebrow">{s.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
          <dl className="mt-4 space-y-2 text-sm">
            {["concentration", "drawdown", "emergency_months"].map((k) => (
              <div key={k} className="flex justify-between border-b border-border/70 pb-2">
                <dt className="text-muted-foreground">{k === "concentration" ? "集中度" : k === "drawdown" ? "估算回撤" : "应急金覆盖"}</dt>
                <dd className="font-mono">{fmt(s.metrics?.[k])}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
};

function interpolate(before: any, after: any) {
  if (!before || !after) return before ?? after;
  const out: any = {};
  for (const k of Object.keys(after)) {
    const b = Number(before[k] ?? 0);
    const a = Number(after[k] ?? 0);
    out[k] = (b + a) / 2;
  }
  return out;
}

export default OutcomeCompare;
