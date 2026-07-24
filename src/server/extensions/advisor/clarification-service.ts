import { getDatabase, createId, isoNow, json, parseJson } from "@/server/http/context";

type ClarificationInput = { userId: string; sessionId: string; analysisId: string; missingQuestions: string[] };

export function createClarification(db: ReturnType<typeof getDatabase>, input: ClarificationInput) {
  const fields = input.missingQuestions.map((question, index) => fieldDefinition(question, index));
  const id = createId("clarification");
  db.prepare(`INSERT INTO information_requests
    (id,user_id,session_id,analysis_id,prompt,fields_json,status,created_at,expires_at)
    VALUES (?,?,?,?,?,?, 'pending',?,?)`).run(id, input.userId, input.sessionId, input.analysisId, "为了继续分析，请补充以下信息。", json(fields), isoNow(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
  return id;
}

export function completeClarification(input: { userId: string; sessionId: string; clarificationId: string; answers: Record<string, unknown> }) {
  const db = getDatabase();
  const request = db.prepare("SELECT * FROM information_requests WHERE id=? AND user_id=? AND session_id=?").get(input.clarificationId, input.userId, input.sessionId) as Record<string, unknown> | undefined;
  if (!request) { db.close(); throw new Error("Clarification not found"); }
  if (request.status !== "pending") { db.close(); throw new Error("CLARIFICATION_ALREADY_ANSWERED"); }
  if (request.expires_at && Date.parse(String(request.expires_at)) <= Date.now()) { db.prepare("UPDATE information_requests SET status='expired' WHERE id=?").run(input.clarificationId); db.close(); throw new Error("CLARIFICATION_EXPIRED"); }
  const fields = parseJson<Array<{ key: string; required?: boolean }>>(String(request.fields_json), []);
  if (fields.some((field) => field.required && (input.answers[field.key] === undefined || input.answers[field.key] === null || String(input.answers[field.key]).trim() === ""))) { db.close(); throw new Error("CLARIFICATION_VALIDATION_FAILED"); }
  const original = db.prepare("SELECT content FROM messages WHERE agent_run_id=? AND session_id=? AND role='user' ORDER BY created_at ASC LIMIT 1").get(request.analysis_id, input.sessionId) as { content?: string } | undefined;
  if (!original?.content) { db.close(); throw new Error("Original message not found"); }
  updateProfileFromAnswers(db, input.userId, input.answers);
  db.prepare("UPDATE information_requests SET status='answered',answers_json=?,answered_at=? WHERE id=? AND status='pending'").run(json(input.answers), isoNow(), input.clarificationId);
  db.close();
  const instrument = input.answers.instrument;
  return {
    originalContent: instrument === undefined
      ? original.content
      : `${original.content}\n补充标的：${String(instrument).trim()}`,
  };
}

function updateProfileFromAnswers(db: ReturnType<typeof getDatabase>, userId: string, answers: Record<string, unknown>) {
  const current = db.prepare("SELECT * FROM user_profiles WHERE user_id=?").get(userId) as Record<string, unknown> | undefined;
  const preferences = parseJson<Record<string, unknown>>(String(current?.preferences_json ?? "{}"), {});
  if (answers.instrumentPreference !== undefined) preferences.instrumentPreference = answers.instrumentPreference;
  if (answers.nearTermUse !== undefined) preferences.nearTermUse = answers.nearTermUse;
  const investmentAmount = answers.investmentAmount ?? current?.investment_amount_decimal ?? null;
  const horizon = answers.holdingPeriod ?? answers.horizon ?? current?.horizon ?? null;
  const maxDrawdown = answers.maxDrawdown ?? current?.max_drawdown_decimal ?? null;
  const riskLevel = answers.riskLevel ?? current?.risk_level ?? null;
  const now = isoNow();
  if (!current) {
    db.prepare(`INSERT INTO user_profiles
      (id,user_id,investment_amount_decimal,horizon,max_drawdown_decimal,risk_level,preferences_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'draft',?,?)`).run(
      createId("profile"), userId, investmentAmount == null ? null : String(investmentAmount), horizon == null ? null : String(horizon).toUpperCase(), maxDrawdown == null ? null : String(maxDrawdown), riskLevel == null ? null : String(riskLevel).toUpperCase(), json(preferences), now, now,
    );
    return;
  }
  db.prepare(`UPDATE user_profiles SET investment_amount_decimal=?, horizon=?, max_drawdown_decimal=?, risk_level=?, preferences_json=?,updated_at=?,version=version+1 WHERE user_id=?`).run(
    investmentAmount == null ? null : String(investmentAmount), horizon == null ? null : String(horizon).toUpperCase(), maxDrawdown == null ? null : String(maxDrawdown), riskLevel == null ? null : String(riskLevel).toUpperCase(), json(preferences), now, userId,
  );
}

function fieldKey(question: string, index: number): string {
  if (question.includes("投入")) return "investmentAmount";
  if (question.includes("持有")) return "holdingPeriod";
  if (question.includes("风险等级")) return "riskLevel";
  if (question.includes("回撤")) return "maxDrawdown";
  if (question.includes("偏好")) return "instrumentPreference";
  if (question.includes("近期")) return "nearTermUse";
  if (question.includes("标的") || question.includes("股票、基金或指数代码")) return "instrument";
  return `answer${index + 1}`;
}

function fieldDefinition(question: string, index: number) {
  const key = fieldKey(question, index);
  if (key === "holdingPeriod") return { key, label: question, type: "SINGLE_CHOICE", options: ["SHORT", "MEDIUM", "LONG"], required: true };
  if (key === "riskLevel") return { key, label: question, type: "SINGLE_CHOICE", options: ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"], required: true };
  if (key === "instrumentPreference") return { key, label: question, type: "SINGLE_CHOICE", options: ["STOCK", "SECTOR_ETF", "BROAD_INDEX_ETF"], required: true };
  if (key === "nearTermUse") return { key, label: question, type: "BOOLEAN", required: true };
  if (key === "maxDrawdown") return { key, label: question, type: "RATIO", required: true };
  if (key === "investmentAmount") return { key, label: question, type: "MONEY", required: true };
  if (key === "instrument") return { key, label: question, type: "TEXT", required: true };
  return { key, label: question, type: "TEXT", required: true };
}
