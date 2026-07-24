import type { EvidencePack } from "@/types/app/recommendation";
import { ShieldCheck, ShieldAlert } from "lucide-react";

interface EvidenceLabProps {
  evidence: EvidencePack | null;
}

const EvidenceLab = ({ evidence }: EvidenceLabProps) => {
  if (!evidence) return <p className="text-sm text-muted-foreground">尚未生成证据包</p>;
  const { workflowDag, skillRuns, dataSnapshots, riskVerdicts, researchMetrics } = evidence;
  const nodes = workflowDag.nodes ?? [];
  const edges = workflowDag.edges ?? [];

  return (
    <div className="space-y-6">
      <section>
        <p className="eyebrow">任务依赖图</p>
        <div className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/30 p-4">
          <DAGView nodes={nodes} edges={edges} />
        </div>
      </section>

      <section>
        <p className="eyebrow">Pandadata / QuantSkills / 内部 Skill 运行</p>
        <table className="mt-3 w-full text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground"><tr><th className="p-2 text-left">Skill</th><th className="p-2">状态</th><th className="p-2 text-right">耗时</th></tr></thead>
          <tbody>
            {skillRuns.map((r, i) => (
              <tr key={i} className="border-b border-border/70"><td className="p-2 font-mono text-xs">{r.skill}</td><td className="p-2 text-center text-xs">{r.status}</td><td className="p-2 text-right font-mono text-xs">{r.latencyMs} ms</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <p className="eyebrow">数据快照</p>
        <div className="mt-3 space-y-2">
          {dataSnapshots.map((s: any, i) => (
            <div key={i} className="rounded-md border border-border bg-card p-3 text-xs">
              <div className="flex items-center justify-between"><span className="font-mono text-primary">{s.source ?? "internal"}</span><span className="text-muted-foreground">{new Date(s.queried_at ?? s.createdAt ?? Date.now()).toLocaleString("zh-CN")}</span></div>
              <div className="mt-2 grid grid-cols-3 gap-4 text-muted-foreground">
                {"rows" in s && <div>行数：<span className="font-mono text-foreground">{s.rows}</span></div>}
                {"total_assets" in s && <div>总资产：<span className="font-mono text-foreground">¥{Math.round(s.total_assets).toLocaleString()}</span></div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">研究指标</p>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          {Object.entries(researchMetrics)
            .filter(([k]) => k !== "note")
            .map(([k, v]) => (
              <div key={k} className="rounded-md border border-border bg-muted/30 p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-1 font-mono text-lg">{formatMetric(v)}</dd>
              </div>
            ))}
        </dl>
        {researchMetrics.note ? <p className="mt-3 text-xs italic text-muted-foreground">{String(researchMetrics.note)}</p> : null}
      </section>

      <section>
        <p className="eyebrow">风险 & 合规节点复核</p>
        <ul className="mt-3 space-y-2 text-sm">
          {riskVerdicts.map((v, i) => (
            <li key={i} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
              {v.verdict === "approved" ? <ShieldCheck className="size-4 text-[hsl(var(--status-down))]" /> : <ShieldAlert className="size-4 text-destructive" />}
              <div className="flex-1">
                <p className="text-sm font-medium">{v.rule}</p>
                <p className="text-xs text-muted-foreground">{v.note ?? (v.verdict === "approved" ? "通过" : v.verdict === "blocked" ? "被拦截" : "警告")}</p>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs ${v.verdict === "approved" ? "bg-[hsl(var(--status-down))]/10 text-[hsl(var(--status-down))]" : "bg-destructive/10 text-destructive"}`}>{v.verdict}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-muted-foreground">所有数据仅用于研究与教育目的，历史指标不代表未来表现。</p>
    </div>
  );
};

const NODE_POS: Record<string, { x: number; y: number }> = {
  planner: { x: 60, y: 40 },
  profile: { x: 240, y: 20 },
  data: { x: 240, y: 80 },
  signal: { x: 420, y: 50 },
  portfolio: { x: 600, y: 50 },
  research: { x: 780, y: 20 },
  risk: { x: 780, y: 80 },
  compliance: { x: 940, y: 50 },
  explain: { x: 1100, y: 50 },
};

const STATUS_COLOR: Record<string, string> = {
  done: "hsl(154 64% 33%)",
  running: "hsl(221 52% 39%)",
  blocked: "hsl(7 58% 44%)",
  skipped: "hsl(145 7% 44%)",
  idle: "hsl(145 7% 44%)",
};

const DAGView = ({ nodes, edges }: { nodes: any[]; edges: any[] }) => {
  return (
    <svg viewBox="0 0 1200 100" className="mx-auto h-[110px] w-full min-w-[900px]">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="hsl(145 7% 44%)" /></marker>
      </defs>
      {edges.map((e, i) => {
        const from = NODE_POS[e.from]; const to = NODE_POS[e.to];
        if (!from || !to) return null;
        return <line key={i} x1={from.x + 30} y1={from.y} x2={to.x - 30} y2={to.y} stroke="hsl(145 7% 44%)" strokeWidth={1.5} strokeDasharray="4 4" markerEnd="url(#arrow)" />;
      })}
      {nodes.map((n) => {
        const pos = NODE_POS[n.id]; if (!pos) return null;
        const color = STATUS_COLOR[n.status] ?? STATUS_COLOR.idle;
        return (
          <g key={n.id} transform={`translate(${pos.x}, ${pos.y})`}>
            <circle r={22} fill="hsl(120 25% 99%)" stroke={color} strokeWidth={2} />
            <text textAnchor="middle" dy={4} className="fill-foreground" style={{ fontSize: 10 }}>{n.label.replace(" Agent", "")}</text>
          </g>
        );
      })}
    </svg>
  );
};

function formatMetric(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (Math.abs(v) < 1) return `${(v * 100).toFixed(1)}%`;
    return v.toFixed(2);
  }
  return String(v);
}

export default EvidenceLab;
