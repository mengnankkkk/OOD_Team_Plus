import { parseJson } from "@/server/http/context";

export function formatRecommendation(row: Record<string, unknown>) {
  return {
    id: row.id,
    instrumentId: row.instrument_id,
    conversationId: row.conversation_id,
    analysisId: row.analysis_id,
    action: row.action,
    status: String(row.status ?? "active").toUpperCase(),
    suitability: row.suitability,
    summary: row.summary,
    confidence: row.confidence_decimal,
    positionRange: parseJson(row.position_range_json as string, []),
    firstPosition: row.first_position,
    addConditions: parseJson(row.add_conditions_json as string, []),
    referenceRange: parseJson(row.reference_range_json as string, null),
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    horizon: row.horizon,
    expiresAt: row.expires_at,
    reasons: parseJson(row.reasons_json as string, []),
    counterEvidence: parseJson(row.counter_evidence_json as string, []),
    risks: parseJson(row.risks_json as string, []),
    alternatives: parseJson(row.alternatives_json as string, []),
    invalidation: row.invalidation,
    compliance: parseJson(row.compliance_json as string, {}),
    dataAsOf: row.data_as_of,
    provenance: parseJson(row.provenance_json as string, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
