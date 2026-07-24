import type { AdvisorDatabase } from "@/server/advisor/database";
import {
  mapClarification,
  mapConversation,
  mapMessage,
  type ConversationContext,
} from "@/server/advisor/conversation-records";
import { json, newId, nowIso, runRows, runValue, runWrite } from "@/server/advisor/store-common";

export type {
  ClarificationRecord,
  ConversationContext,
  ConversationRecord,
  MessageRecord,
} from "@/server/advisor/conversation-records";

export class ConversationStore {
  constructor(private readonly database: AdvisorDatabase) {}

  list(userId: string) {
    return runRows<Record<string, unknown>>(
      this.database,
      "SELECT * FROM conversation_sessions WHERE user_id = ? ORDER BY COALESCE(last_message_at, created_at) DESC",
      userId,
    ).map(mapConversation);
  }

  create(userId: string, input: Record<string, unknown>) {
    const id = newId("conversation");
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO conversation_sessions
       (id, user_id, title, mode, status, context_json, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', '{}', 1, ?, ?)`,
      id,
      userId,
      input.title ?? null,
      input.mode ?? "advisory",
      timestamp,
      timestamp,
    );
    return this.get(userId, id)!;
  }

  get(userId: string, conversationId: string) {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM conversation_sessions WHERE id = ? AND user_id = ?",
      conversationId,
      userId,
    );
    return row ? mapConversation(row) : null;
  }

  update(userId: string, conversationId: string, patch: Record<string, unknown>, expectedVersion?: number) {
    const current = this.get(userId, conversationId);
    if (!current) return null;
    if (expectedVersion != null && expectedVersion !== current.version) throw new Error("VERSION_CONFLICT");
    runWrite(
      this.database,
      `UPDATE conversation_sessions SET title = COALESCE(?, title), status = COALESCE(?, status),
       version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?`,
      patch.title ?? null,
      patch.status == null ? null : String(patch.status).toLowerCase(),
      nowIso(),
      conversationId,
      userId,
    );
    return this.get(userId, conversationId);
  }

  patchContext(userId: string, conversationId: string, patch: ConversationContext) {
    const current = this.get(userId, conversationId);
    if (!current) return null;
    const context = {
      ...current.context,
      ...patch,
    };
    runWrite(
      this.database,
      "UPDATE conversation_sessions SET context_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?",
      json(context),
      nowIso(),
      conversationId,
      userId,
    );
    return this.get(userId, conversationId);
  }

  addMessage(
    userId: string,
    conversationId: string,
    input: { role: string; messageType?: string; content: string; clientMessageId?: string; artifact?: Record<string, unknown> },
  ) {
    if (!this.get(userId, conversationId)) throw new Error("RESOURCE_NOT_FOUND");
    const existing = input.clientMessageId
      ? runValue<Record<string, unknown>>(
          this.database,
          "SELECT * FROM messages WHERE session_id = ? AND client_message_id = ?",
          conversationId,
          input.clientMessageId,
        )
      : undefined;
    if (existing) return mapMessage(existing);
    const sequence = runValue<{ next_sequence: number }>(
      this.database,
      "SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM messages WHERE session_id = ?",
      conversationId,
    )?.next_sequence ?? 1;
    const id = newId("message");
    const createdAt = nowIso();
    runWrite(
      this.database,
      `INSERT INTO messages
       (id, session_id, sequence_no, role, message_type, content_text, client_message_id, delivery_status, artifact_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?)`,
      id,
      conversationId,
      sequence,
      input.role.toLowerCase(),
      input.messageType?.toLowerCase() ?? "text",
      input.content,
      input.clientMessageId ?? null,
      input.artifact ? json(input.artifact) : null,
      createdAt,
    );
    runWrite(
      this.database,
      "UPDATE conversation_sessions SET last_message_at = ?, updated_at = ? WHERE id = ?",
      createdAt,
      createdAt,
      conversationId,
    );
    return this.listMessages(userId, conversationId).at(-1)!;
  }

  listMessages(userId: string, conversationId: string) {
    if (!this.get(userId, conversationId)) throw new Error("RESOURCE_NOT_FOUND");
    return runRows<Record<string, unknown>>(
      this.database,
      "SELECT * FROM messages WHERE session_id = ? ORDER BY sequence_no",
      conversationId,
    ).map(mapMessage);
  }

  createClarification(
    userId: string,
    conversationId: string,
    input: { analysisId?: string; prompt: string; fields: Array<Record<string, unknown>>; blocking?: boolean },
  ) {
    if (!this.get(userId, conversationId)) throw new Error("RESOURCE_NOT_FOUND");
    const id = newId("clarification");
    runWrite(
      this.database,
      `INSERT INTO information_requests
       (id, session_id, analysis_id, prompt_text, fields_json, status, blocking, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      id,
      conversationId,
      input.analysisId ?? null,
      input.prompt,
      json(input.fields),
      input.blocking === false ? 0 : 1,
      nowIso(),
    );
    runWrite(
      this.database,
      "UPDATE conversation_sessions SET status = 'waiting_user', waiting_for_field_code = ?, updated_at = ? WHERE id = ?",
      input.fields[0]?.key ?? null,
      nowIso(),
      conversationId,
    );
    return this.getClarification(userId, conversationId, id)!;
  }

  listClarifications(userId: string, conversationId: string, status?: string) {
    if (!this.get(userId, conversationId)) throw new Error("RESOURCE_NOT_FOUND");
    const rows = runRows<Record<string, unknown>>(
      this.database,
      `SELECT * FROM information_requests WHERE session_id = ?
       ${status ? "AND status = ?" : ""} ORDER BY created_at DESC`,
      ...(status ? [conversationId, status.toLowerCase()] : [conversationId]),
    );
    return rows.map(mapClarification);
  }

  answerClarification(userId: string, conversationId: string, clarificationId: string, answers: Record<string, unknown>) {
    const current = this.getClarification(userId, conversationId, clarificationId);
    if (!current) throw new Error("RESOURCE_NOT_FOUND");
    if (current.status !== "OPEN") throw new Error("CLARIFICATION_ALREADY_ANSWERED");
    runWrite(
      this.database,
      "UPDATE information_requests SET answers_json = ?, status = 'answered', answered_at = ? WHERE id = ?",
      json(answers),
      nowIso(),
      clarificationId,
    );
    runWrite(
      this.database,
      "UPDATE conversation_sessions SET status = 'active', waiting_for_field_code = NULL, updated_at = ? WHERE id = ?",
      nowIso(),
      conversationId,
    );
    return this.getClarification(userId, conversationId, clarificationId)!;
  }

  getClarification(userId: string, conversationId: string, clarificationId: string) {
    if (!this.get(userId, conversationId)) return null;
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM information_requests WHERE id = ? AND session_id = ?",
      clarificationId,
      conversationId,
    );
    return row ? mapClarification(row) : null;
  }
}
