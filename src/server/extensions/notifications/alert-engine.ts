import { createId, getDatabase, isoNow } from "@/server/http/context";

export type ObservationConditionType = "UNREALIZED_GAIN_REACH" | "PRICE_ABOVE" | "PRICE_BELOW" | "DRAWDOWN_REACH";

export async function evaluateWatchConditions(conditionIds: string[], reason: string): Promise<void> {
  evaluateConditions(conditionIds, reason);
}

export function evaluateConditions(conditionIds: string[] | undefined, reason: string) {
  const db = getDatabase();
  const conditions = conditionIds?.length
    ? db.prepare("SELECT * FROM observation_conditions WHERE id IN (" + conditionIds.map(() => "?").join(",") + ") AND status='active'").all(...conditionIds)
    : db.prepare("SELECT * FROM observation_conditions WHERE status='active'").all();
  const results: Array<Record<string, unknown>> = [];
  const now = isoNow();
  for (const condition of conditions as Array<Record<string, unknown>>) {
    const observed = readObservedValue(db, condition);
    const conditionType = String(condition.condition_type) as ObservationConditionType;
    const previous = condition.last_observed_decimal === null || condition.last_observed_decimal === undefined ? null : Number(condition.last_observed_decimal);
    const crossed = observed !== null && hasCrossed(conditionType, previous, observed, Number(condition.threshold_decimal));
    if (observed === null || !crossed) {
      db.prepare("UPDATE observation_conditions SET last_observed_decimal = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?").run(observed === null ? null : String(observed), now, now, condition.id);
      results.push({ conditionId: condition.id, triggered: false, observedValue: observed });
      continue;
    }
    const evaluationKey = `${condition.id}:${String(condition.condition_type)}:${String(condition.threshold_decimal)}:${observed}`;
    const eventId = createId("watch_event");
    const inserted = db.prepare(`INSERT INTO observation_condition_events
      (id, condition_id, user_id, observed_value, threshold_decimal, evaluation_key, triggered_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(evaluation_key) DO NOTHING`).run(eventId, condition.id, condition.user_id, String(observed), condition.threshold_decimal, evaluationKey, now, reason);
    if (inserted.changes) {
      const title = conditionTitle(String(condition.condition_type), observed, String(condition.threshold_decimal));
      const groupKey = `${condition.instrument_id ?? condition.holding_id ?? condition.id}:${condition.condition_type}`;
      db.prepare(`INSERT INTO notifications
        (id, user_id, severity, title, body_text, source_type, source_id, group_key, condition_id, event_id, created_at)
        VALUES (?, ?, 'important', ?, ?, 'WATCH_CONDITION', ?, ?, ?, ?, ?)`).run(
        createId("notification"), condition.user_id, title,
        `${title}。当前值 ${formatNumber(observed)}，阈值 ${formatNumber(Number(condition.threshold_decimal))}。`,
        condition.id, groupKey, condition.id, eventId, now,
      );
      results.push({ conditionId: condition.id, triggered: true, eventId, observedValue: observed });
    } else {
      results.push({ conditionId: condition.id, triggered: false, duplicate: true, observedValue: observed });
    }
    db.prepare("UPDATE observation_conditions SET last_observed_decimal = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?").run(String(observed), now, now, condition.id);
  }
  db.close();
  return results;
}

function readObservedValue(db: { prepare: (sql: string) => { get: (...params: unknown[]) => unknown } }, condition: Record<string, unknown>): number | null {
  if (condition.holding_id) {
    const holding = db.prepare(`SELECT h.quantity_decimal, h.cost_decimal, s.price_decimal, s.market_value_decimal, s.unrealized_pnl_decimal
      FROM holdings h LEFT JOIN portfolio_snapshots p ON p.portfolio_id = h.portfolio_id AND p.user_id = h.user_id
      LEFT JOIN holding_snapshots s ON s.portfolio_snapshot_id = p.id AND s.instrument_id = h.instrument_id
      WHERE h.id = ? AND h.user_id = ? AND h.status='active' ORDER BY p.created_at DESC LIMIT 1`).get(condition.holding_id, condition.user_id) as Record<string, unknown> | undefined;
    if (!holding) return null;
    const quantity = Number(holding.quantity_decimal);
    const cost = Number(holding.cost_decimal) * quantity;
    if (condition.condition_type === "UNREALIZED_GAIN_REACH") return cost ? Number(holding.unrealized_pnl_decimal ?? 0) / cost : null;
    if (condition.condition_type === "DRAWDOWN_REACH") return cost ? (Number(holding.market_value_decimal ?? 0) - cost) / cost : null;
    return Number(holding.price_decimal);
  }
  if (condition.instrument_id) {
    const row = db.prepare(`SELECT price_decimal FROM holding_snapshots h JOIN portfolio_snapshots p ON p.id = h.portfolio_snapshot_id
      WHERE h.instrument_id = ? AND p.user_id = ? ORDER BY p.created_at DESC LIMIT 1`).get(condition.instrument_id, condition.user_id) as { price_decimal?: string } | undefined;
    return row?.price_decimal ? Number(row.price_decimal) : null;
  }
  return null;
}

function isTriggered(type: ObservationConditionType, value: number, threshold: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  if (type === "PRICE_BELOW" || type === "DRAWDOWN_REACH") return value <= threshold;
  return value >= threshold;
}

function hasCrossed(type: ObservationConditionType, previous: number | null, current: number, threshold: number): boolean {
  if (!Number.isFinite(current) || !Number.isFinite(threshold)) return false;
  if (previous === null || !Number.isFinite(previous)) return isTriggered(type, current, threshold);
  if (type === "PRICE_BELOW" || type === "DRAWDOWN_REACH") return previous > threshold && current <= threshold;
  return previous < threshold && current >= threshold;
}

function conditionTitle(type: string, value: number, threshold: string): string {
  const labels: Record<string, string> = { UNREALIZED_GAIN_REACH: "持仓浮盈达到提醒阈值", PRICE_ABOVE: "标的价格上穿提醒阈值", PRICE_BELOW: "标的价格下穿提醒阈值", DRAWDOWN_REACH: "持仓回撤达到提醒阈值" };
  return `${labels[type] ?? "观察条件已触发"}（${formatNumber(value)} / ${formatNumber(Number(threshold))}）`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "") : "未知";
}
