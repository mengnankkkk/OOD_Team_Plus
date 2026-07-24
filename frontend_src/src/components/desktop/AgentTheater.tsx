import { Check, Circle, LoaderCircle, PauseCircle } from "lucide-react";
import type { AgentRun } from "@/types/app/recommendation";

const DEFAULT_STAGES: { key: string; name: string; detail: string }[] = [
  { key: "planner", name: "规划", detail: "拆解任务与依赖" },
  { key: "profile", name: "画像", detail: "读取用户风险与家庭" },
  { key: "data", name: "数据", detail: "盘点持仓与来源" },
  { key: "signal", name: "信号", detail: "识别触发条件" },
  { key: "portfolio", name: "组合", detail: "生成候选方案" },
  { key: "research", name: "研究", detail: "支持与反方证据" },
  { key: "risk", name: "风险", detail: "适当性复核" },
  { key: "compliance", name: "合规", detail: "独立规则拦截" },
  { key: "explain", name: "解释", detail: "写入报告单" },
];

interface AgentTheaterProps {
  latestRun?: AgentRun | null;
  generating?: boolean;
}

const AgentTheater = ({ latestRun, generating }: AgentTheaterProps) => {
  const states = latestRun?.agentStates ?? {};
  const completed = Object.values(states).filter((s: any) => s?.status === "done").length;

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-end justify-between">
        <div><p className="eyebrow">Multi-Agent 剧场</p><h2 className="mt-2 text-xl font-semibold">这条建议如何被做出来</h2></div>
        <p className="text-xs text-muted-foreground">
          {generating ? "工作流运行中…" : latestRun ? `最近一次：${new Date(latestRun.startedAt).toLocaleString("zh-CN")} · ${completed} / ${DEFAULT_STAGES.length}` : "尚未运行 · 生成建议后自动激活"}
        </p>
      </div>
      <div className="agent-track grid gap-3 md:grid-cols-3 xl:grid-cols-9">
        {DEFAULT_STAGES.map((stage) => {
          const s: any = states[stage.key];
          const status = generating ? (s?.status ?? "running") : (s?.status ?? "idle");
          const isActive = status === "running";
          return (
            <article key={stage.key} className={`agent-card ${isActive ? "agent-card-active" : status === "done" ? "opacity-100" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{stage.name}</span>
                {status === "done" ? <Check className="size-4 text-[hsl(var(--status-down))]" /> : isActive ? <LoaderCircle className="size-4 animate-spin text-primary" /> : status === "blocked" ? <PauseCircle className="size-4 text-destructive" /> : <Circle className="size-4 text-muted-foreground" />}
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground line-clamp-4">{s?.summary ?? stage.detail}</p>
              {s?.durationMs ? <p className="mt-2 font-mono text-[10px] text-muted-foreground">{s.durationMs} ms</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default AgentTheater;
