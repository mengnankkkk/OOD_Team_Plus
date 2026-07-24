"use client";

import { Activity, GitBranch, RotateCcw, Sparkles } from "lucide-react";

import { shortDate } from "../lib/api";

type TimelineEvent = { id?: string; event_type?: string; eventType?: string; created_at?: string; createdAt?: string; payload?: Record<string, unknown> };

const labels: Record<string, string> = {
  root_created: "建立初始资产分支",
  option_executed: "执行模拟方案",
  branch_switched: "切换当前分支",
  undo: "撤回到父分支",
  "run.started": "Agent run 已排队",
  "agent.started": "Agent 开始工作",
  "agent.delegated": "委派专业角色",
  "agent.completed": "专业角色完成",
  "branch.options.created": "候选方案已生成",
  "run.completed": "候选生成完成",
  "run.failed": "候选生成失败",
  "branch.options.failed": "候选入库失败",
};

export function BranchEventTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <div className="state-panel"><p>还没有分支事件。</p></div>;
  return <div className="event-timeline">
    {[...events].reverse().map((event, index) => {
      const type = event.eventType ?? event.event_type ?? "agent.completed";
      const icon = type === "undo" ? <RotateCcw size={14} /> : type.includes("agent") || type.includes("run") ? <Sparkles size={14} /> : type.includes("branch") ? <GitBranch size={14} /> : <Activity size={14} />;
      return <div className="event-item" key={event.id ?? `${type}-${index}`}><span className="event-icon">{icon}</span><div><strong>{labels[type] ?? type}</strong><small>{shortDate(event.createdAt ?? event.created_at)}{event.payload?.agent ? ` · ${String(event.payload.agent)}` : ""}</small></div></div>;
    })}
  </div>;
}
