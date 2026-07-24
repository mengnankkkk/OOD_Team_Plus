import type { AdvisorDatabase } from "@/server/advisor/database";
import { json, newId, nowIso, parseJson, runRows, runValue, runWrite } from "@/server/advisor/store-common";

export class DecisionStore {
  constructor(private readonly database: AdvisorDatabase) {}

  saveSimulation<T extends Record<string, unknown>>(userId: string, recommendationId: string, result: T) {
    const id = newId("simulation");
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO simulations
       (id, user_id, recommendation_id, status, result_json, created_at, completed_at)
       VALUES (?, ?, ?, 'succeeded', ?, ?, ?)`,
      id,
      userId,
      recommendationId,
      json({ id, recommendationId, ...result }),
      timestamp,
      timestamp,
    );
    return { id, recommendationId, status: "COMPLETED" as const, ...result };
  }

  getSimulation(userId: string, simulationId: string) {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT result_json FROM simulations WHERE id = ? AND user_id = ?",
      simulationId,
      userId,
    );
    return row ? parseJson<Record<string, unknown>>(row.result_json, {}) : null;
  }

  saveDecision(userId: string, input: Record<string, unknown>) {
    if (input.clientRequestId) {
      const existing = runValue<{ id: string; result_json?: string }>(
        this.database,
        "SELECT id FROM decision_logs WHERE user_id = ? AND client_request_id = ?",
        userId,
        input.clientRequestId,
      );
      if (existing) {
        const saved = this.getDecision(userId, existing.id);
        return saved ? { ...saved, duplicate: true } : { id: existing.id, duplicate: true };
      }
    }
    const id = newId("decision");
    const createdAt = nowIso();
    runWrite(
      this.database,
      `INSERT INTO decision_logs
       (id, user_id, session_id, recommendation_id, simulation_id, action, reason_codes_json, note, client_request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      input.sessionId ?? null,
      input.recommendationId,
      input.simulationId ?? null,
      input.action,
      json(input.reasonCodes ?? []),
      input.note ?? null,
      input.clientRequestId ?? null,
      createdAt,
    );
    return {
      id,
      recommendationId: input.recommendationId,
      simulationId: input.simulationId ?? null,
      action: input.action,
      reasonCodes: input.reasonCodes ?? [],
      note: input.note ?? null,
      recordedAt: createdAt,
      ordersCreated: false,
    };
  }

  listDecisions(userId: string, action?: string) {
    const rows = runRows<Record<string, unknown>>(
      this.database,
      `SELECT * FROM decision_logs WHERE user_id = ? ${action ? "AND action = ?" : ""} ORDER BY created_at DESC`,
      ...(action ? [userId, action] : [userId]),
    );
    return rows.map(mapDecision);
  }

  getDecision(userId: string, decisionId: string) {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM decision_logs WHERE id = ? AND user_id = ?",
      decisionId,
      userId,
    );
    return row ? mapDecision(row) : null;
  }

  listWatchConditions(userId: string, status?: string) {
    return runRows<Record<string, unknown>>(
      this.database,
      `SELECT * FROM watch_conditions WHERE user_id = ? ${status ? "AND status = ?" : ""} ORDER BY created_at DESC`,
      ...(status ? [userId, status.toLowerCase()] : [userId]),
    ).map(mapCondition);
  }

  createWatchCondition(userId: string, input: Record<string, unknown>) {
    const id = newId("condition");
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO watch_conditions
       (id, user_id, recommendation_id, instrument_id, type, severity, parameters_json, status,
        valid_until, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?)`,
      id,
      userId,
      input.recommendationId ?? null,
      input.instrumentId ?? null,
      input.type,
      input.severity ?? "attention",
      json(input.parameters ?? {}),
      input.validUntil ?? null,
      timestamp,
      timestamp,
    );
    return this.listWatchConditions(userId).find((condition) => condition.id === id)!;
  }

  updateWatchCondition(userId: string, id: string, patch: Record<string, unknown>, expectedVersion?: number) {
    const current = this.listWatchConditions(userId).find((condition) => condition.id === id);
    if (!current) return null;
    if (expectedVersion != null && current.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
    runWrite(
      this.database,
      `UPDATE watch_conditions SET severity = COALESCE(?, severity), parameters_json = COALESCE(?, parameters_json),
       status = COALESCE(?, status), version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?`,
      patch.severity ?? null,
      patch.parameters ? json(patch.parameters) : null,
      patch.status == null ? null : String(patch.status).toLowerCase(),
      nowIso(),
      id,
      userId,
    );
    return this.listWatchConditions(userId).find((condition) => condition.id === id)!;
  }

  deleteWatchCondition(userId: string, id: string) {
    return runWrite(this.database, "DELETE FROM watch_conditions WHERE id = ? AND user_id = ?", id, userId).changes > 0;
  }

  recordWatchEvent(conditionId: string, status: string, observedValue: unknown, summary: string) {
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO watch_condition_events(id, watch_condition_id, status, observed_value, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      newId("condition_event"),
      conditionId,
      status,
      observedValue == null ? null : String(observedValue),
      summary,
      timestamp,
    );
    runWrite(
      this.database,
      `UPDATE watch_conditions SET last_evaluated_at = ?, last_triggered_at = CASE WHEN ? = 'TRIGGERED' THEN ? ELSE last_triggered_at END
       WHERE id = ?`,
      timestamp,
      status,
      timestamp,
      conditionId,
    );
    return {
      conditionId,
      status,
      observedValue: observedValue ?? null,
      summary,
      evaluatedAt: timestamp,
    };
  }
}

function mapDecision(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    recommendationId: String(row.recommendation_id),
    simulationId: row.simulation_id as string | null,
    action: String(row.action).toUpperCase(),
    reasonCodes: parseJson(row.reason_codes_json, []),
    note: row.note as string | null,
    recordedAt: String(row.created_at),
    ordersCreated: false,
  };
}

function mapCondition(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    recommendationId: row.recommendation_id as string | null,
    instrumentId: row.instrument_id as string | null,
    type: String(row.type).toUpperCase(),
    severity: String(row.severity).toUpperCase(),
    parameters: parseJson(row.parameters_json, {}),
    status: String(row.status).toUpperCase(),
    validUntil: row.valid_until as string | null,
    version: Number(row.version),
    lastEvaluatedAt: row.last_evaluated_at as string | null,
    lastTriggeredAt: row.last_triggered_at as string | null,
  };
}
