import { parseJson } from "@/server/advisor/store-common";

export type ConversationContext = {
  holdingPeriod?: "SHORT" | "MEDIUM" | "LONG";
  investmentAmount?: string;
  maxDrawdown?: number;
  nearTermUse?: boolean;
  instrumentPreference?: string;
};

export type ConversationRecord = {
  id: string;
  userId: string;
  title: string | null;
  mode: string;
  status: string;
  currentIntent: string | null;
  lastMessageAt: string | null;
  waitingForFieldCode: string | null;
  context: ConversationContext;
  version: number;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  sequence: number;
  role: string;
  messageType: string;
  content: string;
  artifact: Record<string, unknown> | null;
  createdAt: string;
};

export type ClarificationRecord = {
  id: string;
  analysisId: string | null;
  prompt: string;
  fields: Array<Record<string, unknown>>;
  answers: Record<string, unknown> | null;
  status: string;
  blocking: boolean;
};

export function mapConversation(row: Record<string, unknown>): ConversationRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: row.title as string | null,
    mode: String(row.mode).toUpperCase(),
    status: String(row.status).toUpperCase(),
    currentIntent: row.current_intent as string | null,
    lastMessageAt: row.last_message_at as string | null,
    waitingForFieldCode: row.waiting_for_field_code as string | null,
    context: parseJson<ConversationContext>(row.context_json, {}),
    version: Number(row.version),
  };
}

export function mapMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: String(row.id),
    conversationId: String(row.session_id),
    sequence: Number(row.sequence_no),
    role: String(row.role).toUpperCase(),
    messageType: String(row.message_type).toUpperCase(),
    content: String(row.content_text ?? ""),
    artifact: parseJson(row.artifact_json, null),
    createdAt: String(row.created_at),
  };
}

export function mapClarification(row: Record<string, unknown>): ClarificationRecord {
  return {
    id: String(row.id),
    analysisId: row.analysis_id as string | null,
    prompt: String(row.prompt_text),
    fields: parseJson(row.fields_json, []),
    answers: parseJson(row.answers_json, null),
    status: String(row.status).toUpperCase(),
    blocking: Number(row.blocking) === 1,
  };
}
