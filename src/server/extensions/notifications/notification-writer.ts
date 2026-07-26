import { createId, getDatabase, isoNow, json } from "@/server/http/context";

import { allowsNotification, readNotificationPreference } from "./preference-policy";

export type NotificationSeverity = "information" | "attention" | "important" | "urgent";

export function insertNotification(db: ReturnType<typeof getDatabase>, input: {
  userId: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sourceType: string;
  sourceId: string;
  groupKey: string;
  dedupeKey: string;
  dataAsOf: string;
  metadata: Record<string, unknown>;
  conditionId?: string;
  eventId?: string;
}): number {
  if (!allowsNotification(readNotificationPreference(db, input.userId), input.severity)) return 0;
  const now = isoNow();
  const result = db.prepare(`INSERT OR IGNORE INTO notifications
    (id,user_id,severity,title,body_text,source_type,source_id,group_key,condition_id,event_id,
     metadata_json,data_as_of,dedupe_key,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    createId("notification"), input.userId, input.severity, input.title, input.body, input.sourceType,
    input.sourceId, input.groupKey, input.conditionId ?? null, input.eventId ?? null,
    json(input.metadata), input.dataAsOf, input.dedupeKey, now, now,
  );
  return result.changes;
}

export function advisorPrompt(name: string, symbol: string, signal: string, value: number, dataAsOf: string, reason?: string | null): string {
  return `请分析提醒：${name}${symbol ? `（${symbol}）` : ""}出现“${signal}”，指标值 ${formatPercent(value, false)}，数据截至 ${dataAsOf}${reason ? `，我的关注理由是“${reason}”` : ""}。请结合我的画像和当前持仓，给出支持证据、反方证据、组合影响、观察条件与可模拟方案；不要直接替我下单。`;
}

export function formatPercent(value: number, signed = true): string {
  const number = value * 100;
  const rounded = Math.round((number + Number.EPSILON) * 100) / 100;
  return `${signed && rounded > 0 ? "+" : ""}${rounded}%`;
}
