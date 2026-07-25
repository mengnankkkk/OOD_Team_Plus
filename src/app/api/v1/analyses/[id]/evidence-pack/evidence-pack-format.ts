type Row = Record<string, unknown>;

export function summarizeFreshness(snapshots: Row[], skillRuns: Row[]) {
  const dates = snapshots.map((item) => String(item.as_of ?? "")).filter(Boolean).sort();
  const latestByInstrument = new Map<string, Row>();
  for (const snapshot of snapshots) {
    const key = String(snapshot.instrument_id ?? snapshot.symbol ?? snapshot.id);
    const current = latestByInstrument.get(key);
    if (!current || String(snapshot.as_of ?? "") > String(current.as_of ?? "")) latestByInstrument.set(key, snapshot);
  }
  const latestSnapshots = [...latestByInstrument.values()];
  const hasStale = latestSnapshots.some((item) => String(item.freshness_status).toLowerCase() === "stale");
  const hasFailed = skillRuns.some((item) => String(item.status).toLowerCase() === "failed");
  const hasStaleSkillOnly = !snapshots.length && skillRuns.some((item) => String(item.quality_status).toLowerCase() === "stale");
  return {
    marketDataAsOf: dates.at(-1) ?? null,
    financialReportPeriod: null,
    status: snapshots.length ? hasStale ? "STALE" : "FRESH" : hasFailed ? "UNAVAILABLE" : hasStaleSkillOnly ? "STALE" : "NOT_REQUIRED",
  };
}

export function buildMissingEvidence(input: {
  evidence: Row[];
  evidenceLinks: Row[];
  toolCalls: Row[];
  skillRuns: Row[];
  marketSnapshots: Row[];
  recommendations: Row[];
  conflicts: Row[];
  compliance: Record<string, unknown>;
}): string[] {
  const missing = new Set<string>();
  if (!input.evidence.length) missing.add("该分析尚未写入结构化证据。");
  if (!input.evidence.some((item) => String(item.stance).toLowerCase() === "support")) missing.add("缺少多方证据。");
  if (!input.evidence.some((item) => ["counter", "bear"].includes(String(item.stance).toLowerCase()))) missing.add("缺少空方证据。");
  if (input.toolCalls.length && !input.skillRuns.length) missing.add("工具调用没有关联 Skill Run。");
  if (input.skillRuns.some((item) => String(item.status).toLowerCase() === "succeeded") && !input.marketSnapshots.length) missing.add("成功的数据 Skill 没有关联市场快照。");
  if (input.skillRuns.some((item) => String(item.status).toLowerCase() === "failed") && !input.marketSnapshots.length) missing.add("缺少可用市场行情。");
  const linkedIds = new Set(input.evidenceLinks.map((item) => String(item.evidence_id)));
  if (input.evidence.some((item) => {
    if (linkedIds.has(String(item.id))) return false;
    return !/^https?:\/\//iu.test(String(item.source_url ?? ""));
  })) missing.add("部分证据缺少可追溯的数据来源。");
  for (const item of input.evidence) {
    if (String(item.stance).toLowerCase() === "missing") {
      const statement = String(item.statement ?? item.summary ?? item.title ?? "").trim();
      if (statement) missing.add(statement);
    }
  }
  if (!input.recommendations.length) missing.add("该分析没有生成建议卡。");
  if (input.conflicts.some((item) => String(item.resolution_status).toLowerCase() === "unresolved")) missing.add("仍存在未解决的 Agent 冲突。");
  if (String(input.compliance.status ?? "").toUpperCase() === "BLOCKED") missing.add("风险与合规发布门已阻断该建议。");
  return [...missing];
}

export function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    /token|password|secret|api[_-]?key|authorization|cookie/iu.test(key) ? "[REDACTED]" : sanitizePayload(item),
  ]));
}

const PUBLIC_AGENT_PURPOSES: Record<string, string> = {
  chief_advisor: "统筹画像、数据、组合风险、建议与合规结论",
  profile_context: "核对用户画像、目标、资金约束与持仓事实",
  data_research: "核验市场数据、估值与资讯证据",
  research_search: "检索基本面、消息面与公开来源证据",
  portfolio_risk: "评估集中度、回撤约束与压力情景",
  recommendation: "汇总证据并形成候选建议方案",
  compliance_reviewer: "检查证据完整性、适当性与发布条件",
  explanation_report: "整理面向用户的结论与证据链",
};

export function publicAgentPurpose(item: Row): string {
  const agent = String(item.agent_type ?? item.type ?? "").toLowerCase();
  if (PUBLIC_AGENT_PURPOSES[agent]) return PUBLIC_AGENT_PURPOSES[agent];

  const objective = String(item.objective ?? "").replace(/\s+/gu, " ").trim();
  const containsInternalContext = /当前角色|服务端上下文|确定性节点发现|已完成的上游发现|请动态委派/iu.test(objective);
  if (!objective || objective.length > 160 || containsInternalContext) return "执行专业分析任务";
  return objective;
}
