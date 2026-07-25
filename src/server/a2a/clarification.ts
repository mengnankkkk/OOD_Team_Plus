import { completeClarification } from "@/server/extensions/advisor/clarification-service";
import { runConversationAgent, type ConversationOutputMode } from "@/server/extensions/advisor/service";
import { getDatabase, parseJson } from "@/server/http/context";

export function getA2AClarificationReplay(userId: string, sessionId: string, messageId: string): Record<string, unknown> | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT r.result_json
    FROM messages m JOIN agent_runs r ON r.id=m.agent_run_id
    WHERE m.session_id=? AND m.role='user' AND m.client_message_id LIKE ? AND r.user_id=? LIMIT 1`).get(sessionId, `clarification:%:${messageId}`, userId) as { result_json?: string } | undefined;
  db.close();
  return row?.result_json ? parseJson<Record<string, unknown> | null>(row.result_json, null) : null;
}

export async function answerA2AClarification(input: {
  userId: string;
  sessionId: string;
  clarificationId: string;
  text: string;
  messageId: string;
  outputMode: ConversationOutputMode;
}) {
  const request = getClarificationRequest(input.userId, input.sessionId, input.clarificationId);
  const answers = parseClarificationAnswers(input.text, request.fields_json);
  const clarification = completeClarification({
    userId: input.userId,
    sessionId: input.sessionId,
    clarificationId: input.clarificationId,
    answers,
    allowPartial: true,
  });
  if (clarification.pending) {
    return {
      messageId: `a2a_clarification_${input.messageId}`,
      assistantMessageId: `a2a_clarification_${input.messageId}`,
      analysis: { analysisId: clarification.analysisId, type: "ADVISORY", status: "WAITING_FOR_USER" },
      outputMode: input.outputMode,
      answer: `已保存本轮补充信息，仍需：\n${clarification.missingFields.map((field) => `- ${field.label}`).join("\n")}`,
      recommendationId: null,
      missingQuestions: clarification.missingFields.map((field) => field.label),
      clarificationId: input.clarificationId,
      dataQueryId: null,
    };
  }
  return runConversationAgent({
    userId: input.userId,
    sessionId: input.sessionId,
    content: clarification.originalContent,
    clientMessageId: `clarification:${input.clarificationId}:${input.messageId}`,
    outputMode: input.outputMode,
  });
}

function getClarificationRequest(userId: string, sessionId: string, clarificationId: string): { fields_json: string } {
  const db = getDatabase();
  const row = db.prepare("SELECT fields_json FROM information_requests WHERE id=? AND user_id=? AND session_id=? AND status='pending'").get(clarificationId, userId, sessionId) as { fields_json?: string } | undefined;
  db.close();
  if (!row?.fields_json) throw new Error("Clarification not found");
  return { fields_json: row.fields_json };
}

function parseClarificationAnswers(text: string, fieldsJson: string): Record<string, unknown> {
  const fields = safeParseFields(fieldsJson);
  const trimmed = text.trim();
  const parsedJson = tryParseObject(trimmed);
  if (parsedJson) return parsedJson;
  const answers: Record<string, unknown> = {};
  const chunks = trimmed.split(/[\n,，;；]+/u).map((chunk) => chunk.trim()).filter(Boolean);
  for (const field of fields) {
    const explicit = chunks.find((chunk) => new RegExp(`^(?:${escapeRegExp(field.key)}|${escapeRegExp(field.label)})\\s*[:：=]`, "iu").test(chunk));
    if (explicit) {
      answers[field.key] = explicit.replace(new RegExp(`^(?:${escapeRegExp(field.key)}|${escapeRegExp(field.label)})\\s*[:：=]\\s*`, "iu"), "").trim();
      continue;
    }
    const match = matchFieldValue(field, trimmed);
    if (match !== undefined) answers[field.key] = match;
  }
  if (!Object.keys(answers).length && fields.length === 1) answers[fields[0].key] = trimmed;
  return answers;
}

function safeParseFields(value: string): Array<{ key: string; label: string; options?: string[] }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((field): field is { key: string; label: string; options?: string[] } => Boolean(field) && typeof field === "object" && typeof (field as { key?: unknown }).key === "string")
      : [];
  } catch {
    return [];
  }
}

function tryParseObject(value: string): Record<string, unknown> | null {
  if (!value.startsWith("{") || !value.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function matchFieldValue(field: { key: string; label: string; options?: string[] }, text: string): string | boolean | undefined {
  const option = field.options?.find((candidate) => text.toUpperCase().includes(candidate.toUpperCase()));
  if (option) return option;
  const localized = localizedOption(field.key, text);
  if (localized) return localized;
  if (field.key === "nearTermUse") {
    if (/是|需要|近期用|要用/u.test(text)) return true;
    if (/否|不需要|不用/u.test(text)) return false;
  }
  if (field.key === "investmentAmount") return text.match(/[¥￥$]?\s*[\d,.]+\s*(?:万|万元|元)?/u)?.[0]?.replaceAll(",", "");
  if (field.key === "maxDrawdown") return text.match(/\d+(?:\.\d+)?\s*%/u)?.[0] ?? text.match(/\d+(?:\.\d+)?/u)?.[0];
  return undefined;
}

function localizedOption(key: string, text: string): string | undefined {
  if (key === "riskLevel") {
    if (/稳健|保守/u.test(text)) return "CONSERVATIVE";
    if (/平衡|均衡/u.test(text)) return "BALANCED";
    if (/进取|激进/u.test(text)) return "AGGRESSIVE";
  }
  if (key === "holdingPeriod") {
    if (/短线|短期/u.test(text)) return "SHORT";
    if (/中线|中期/u.test(text)) return "MEDIUM";
    if (/长线|长期/u.test(text)) return "LONG";
  }
  if (key === "instrumentPreference") {
    if (/个股|股票/u.test(text)) return "STOCK";
    if (/行业\s*ETF|行业基金/u.test(text)) return "SECTOR_ETF";
    if (/宽基|指数\s*ETF|指数基金/u.test(text)) return "BROAD_INDEX_ETF";
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
