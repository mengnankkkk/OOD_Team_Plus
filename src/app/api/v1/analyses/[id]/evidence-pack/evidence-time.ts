type Row = Record<string, unknown>;

export type EvidenceTimeBasis =
  | "MARKET_DATA"
  | "SOURCE_VERIFIED"
  | "PORTFOLIO_SNAPSHOT"
  | "PROFILE_SNAPSHOT"
  | "EVIDENCE_CREATED";

export type EvidenceTime = {
  dataAsOf: string;
  timeBasis: EvidenceTimeBasis;
};

export function resolveEvidenceTime(input: {
  evidence: Row;
  links: Row[];
  skillRuns: Row[];
  portfolioSnapshot?: Row;
  riskAssessment?: Row;
  profileSnapshot?: Row;
}): EvidenceTime {
  const stance = String(input.evidence.stance ?? "").toLowerCase();
  if (stance === "missing") return createdEvidenceTime(input.evidence);

  const linkedMarketTime = latestTimestamp(input.links.map((item) => item.snapshot_as_of));
  if (linkedMarketTime) return { dataAsOf: linkedMarketTime, timeBasis: "MARKET_DATA" };

  const agent = String(input.evidence.evidence_agent_type ?? "").toLowerCase();
  const kind = String(input.evidence.kind ?? "").toLowerCase();
  if (agent === "data_research" || kind === "market_fact") {
    const skillMarketTime = latestTimestamp(input.skillRuns.map((item) => item.data_as_of));
    if (skillMarketTime) return { dataAsOf: skillMarketTime, timeBasis: "MARKET_DATA" };
    const persistedMarketTime = input.evidence.observed_at
      && input.evidence.observed_at !== input.evidence.created_at
      ? String(input.evidence.observed_at)
      : null;
    if (persistedMarketTime) return { dataAsOf: persistedMarketTime, timeBasis: "MARKET_DATA" };
    const skillVerifiedAt = latestTimestamp(input.skillRuns.flatMap((item) => [
      item.completed_at,
      item.started_at,
      item.created_at,
    ]));
    const runVerifiedAt = latestTimestamp([
      input.evidence.evidence_run_completed_at,
      input.evidence.evidence_run_started_at,
      input.evidence.evidence_run_created_at,
      input.evidence.observed_at,
    ]);
    return {
      dataAsOf: skillVerifiedAt ?? runVerifiedAt ?? String(input.evidence.created_at),
      timeBasis: "SOURCE_VERIFIED",
    };
  }

  if (agent === "portfolio_risk" && input.portfolioSnapshot?.as_of) {
    return {
      dataAsOf: String(input.evidence.observed_at ?? input.portfolioSnapshot.as_of),
      timeBasis: "PORTFOLIO_SNAPSHOT",
    };
  }
  const profileTime = input.riskAssessment?.created_at
    ?? input.profileSnapshot?.updated_at
    ?? input.profileSnapshot?.created_at;
  if (agent === "profile_context" && profileTime) {
    return {
      dataAsOf: String(input.evidence.observed_at ?? profileTime),
      timeBasis: "PROFILE_SNAPSHOT",
    };
  }
  return createdEvidenceTime(input.evidence);
}

export function formatEvidenceSource(item: Row, fallback: EvidenceTime) {
  const marketDataAsOf = item.snapshot_as_of ?? item.linked_skill_data_as_of;
  const verifiedAt = item.linked_skill_completed_at ?? item.linked_skill_started_at ?? item.linked_skill_created_at;
  return {
    type: String(item.source_code ?? "UNKNOWN").toUpperCase(),
    name: item.source_name,
    reference: item.source_locator ?? null,
    toolCallId: item.tool_call_id ?? null,
    marketSnapshotId: item.market_snapshot_id ?? null,
    dataAsOf: marketDataAsOf ?? verifiedAt ?? fallback.dataAsOf,
    timeBasis: marketDataAsOf ? "MARKET_DATA" : verifiedAt ? "SOURCE_VERIFIED" : fallback.timeBasis,
    freshness: item.freshness_status ? String(item.freshness_status).toUpperCase() : null,
    metric: item.linked_metric_code ? {
      code: item.linked_metric_code,
      value: item.linked_value_decimal ?? item.linked_value_text,
    } : null,
    excerpt: item.excerpt ?? null,
  };
}

export function verifiedDataTime(row: Row): EvidenceTime {
  const marketDataAsOf = row.data_as_of ?? row.dataAsOf;
  if (marketDataAsOf) return { dataAsOf: String(marketDataAsOf), timeBasis: "MARKET_DATA" };
  return {
    dataAsOf: String(row.completed_at ?? row.completedAt ?? row.started_at ?? row.startedAt ?? row.created_at ?? row.createdAt),
    timeBasis: "SOURCE_VERIFIED",
  };
}

function createdEvidenceTime(evidence: Row): EvidenceTime {
  return {
    dataAsOf: String(evidence.observed_at ?? evidence.created_at),
    timeBasis: "EVIDENCE_CREATED",
  };
}

function latestTimestamp(values: unknown[]): string | null {
  const timestamps = values.map((value) => value == null ? "" : String(value)).filter(Boolean).sort();
  return timestamps.at(-1) ?? null;
}
