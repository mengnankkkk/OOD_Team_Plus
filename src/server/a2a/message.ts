import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { runConversationAgent, type ConversationOutputMode } from "@/server/extensions/advisor/service";
import { createId, getDatabase, isoNow } from "@/server/http/context";

type A2ATextPart = { kind?: string; type?: string; text?: unknown };
type A2AMessage = {
  kind?: string;
  role?: string;
  messageId?: string;
  contextId?: string;
  taskId?: string;
  parts?: A2ATextPart[];
};
type A2ASendRequest = {
  message?: A2AMessage;
  configuration?: { acceptedOutputModes?: string[] };
  text?: string;
  input?: string;
  task?: string;
  prompt?: string;
};
type JsonRpcEnvelope = { jsonrpc?: string; id?: string | number | null; method?: string; params?: A2ASendRequest };
type RpcContext = { id: string | number | null } | null;

export async function handleSendMessage(request: NextRequest): Promise<Response> {
  const rawBody = await request.json().catch(() => null) as (A2ASendRequest & JsonRpcEnvelope) | null;
  const rpc = jsonRpcContext(rawBody);
  const authFailure = authenticate(request);
  if (authFailure) return a2aError(authFailure.status, authFailure.code, authFailure.message, rpc);
  if (rawBody && rawBody.jsonrpc && rawBody.method !== "message/send") {
    return a2aError(400, "METHOD_NOT_FOUND", "Unsupported A2A JSON-RPC method.", rpc);
  }
  const body = rawBody?.jsonrpc ? rawBody.params ?? null : rawBody;
  const parsed = parseSendRequest(body);
  if (!parsed.ok) return a2aError(400, "INVALID_REQUEST", parsed.message, rpc);

  const userId = ensureServiceUser();
  const contextId = await ensureConversationContext(userId, parsed.contextId, parsed.taskId, parsed.text);
  try {
    const result = await runConversationAgent({
      userId,
      sessionId: contextId,
      content: parsed.text,
      clientMessageId: parsed.messageId,
      outputMode: outputModeFor(parsed.acceptedOutputModes),
    });
    return a2aJson(resultForRpc(taskFromResult(result as AdvisorResult, contextId, parsed.text), rpc));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed";
    const code = message === "RUN_ALREADY_ACTIVE" ? "RUN_ALREADY_ACTIVE" : "AGENT_RUN_FAILED";
    const status = message === "RUN_ALREADY_ACTIVE" ? 409 : 500;
    return a2aError(status, code, message, rpc);
  }
}

type AdvisorResult = {
  messageId?: string;
  assistantMessageId?: string;
  analysis?: { analysisId?: string; status?: string; streamUrl?: string };
  answer?: string | null;
  recommendationId?: string | null;
  missingQuestions?: string[];
  dataQueryId?: string | null;
  outputMode?: string;
  artifact?: unknown;
};

function parseSendRequest(body: A2ASendRequest | null):
  | { ok: true; text: string; messageId: string; contextId: string | null; taskId: string | null; acceptedOutputModes: string[] }
  | { ok: false; message: string } {
  const text = extractText(body);
  if (!text) return { ok: false, message: "A2A message.parts must contain text." };
  const message = body?.message;
  return {
    ok: true,
    text,
    messageId: cleanId(message?.messageId) || createId("a2a_message"),
    contextId: cleanId(message?.contextId),
    taskId: cleanId(message?.taskId),
    acceptedOutputModes: Array.isArray(body?.configuration?.acceptedOutputModes)
      ? body.configuration.acceptedOutputModes
      : [],
  };
}

function extractText(body: A2ASendRequest | null): string {
  const direct = [body?.text, body?.input, body?.task, body?.prompt].find((value) => typeof value === "string" && value.trim());
  if (direct) return direct.trim();
  return (body?.message?.parts ?? [])
    .filter((part) => part.kind === "text" || part.type === "text" || typeof part.text === "string")
    .map((part) => typeof part.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function ensureConversationContext(userId: string, requestedContextId: string | null, taskId: string | null, text: string): Promise<string> {
  const db = getDatabase();
  const task = taskId ? db.prepare("SELECT session_id FROM agent_runs WHERE id=? AND user_id=?").get(taskId, userId) as { session_id?: string } | undefined : undefined;
  const id = task?.session_id || requestedContextId || createId("a2a_context");
  const now = isoNow();
  db.prepare(`INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES (?,?,?,'active',?,?,1)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`).run(
    id,
    userId,
    titleFor(text),
    now,
    now,
  );
  db.close();
  return id;
}

function ensureServiceUser(): string {
  const userId = "a2a-remote-agent";
  const username = userId.replaceAll(/[^a-z0-9_]/giu, "_").toLowerCase().slice(0, 60) || "a2a_remote_agent";
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT OR IGNORE INTO users
    (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
    VALUES (?,?,?,?, 'USER','ACTIVE',0,?,?,1)`).run(
    userId,
    username,
    username,
    "A2A Remote Agent",
    now,
    now,
  );
  db.close();
  return userId;
}

function taskFromResult(result: AdvisorResult, contextId: string, userText: string) {
  const analysisId = result.analysis?.analysisId || createId("a2a_task");
  const answer = withRiskNotice(result.answer || "任务已接收，但当前还没有可发布结论。");
  const state = stateFrom(result);
  return {
    kind: "task",
    id: analysisId,
    contextId,
    status: {
      state,
      timestamp: isoNow(),
      message: {
        kind: "message",
        role: "agent",
        messageId: result.assistantMessageId || createId("a2a_agent_message"),
        taskId: analysisId,
        contextId,
        parts: [{ kind: "text", text: answer }],
      },
    },
    artifacts: state === "completed" ? [{
      artifactId: result.recommendationId || analysisId,
      name: "research_result",
      parts: [{ kind: "text", text: answer }],
      metadata: {
        outputMode: result.outputMode || "SQL_ONLY",
        recommendationId: result.recommendationId ?? null,
        dataQueryId: result.dataQueryId ?? null,
        generatedArtifact: result.artifact ?? null,
      },
    }] : [],
    history: [
      {
        kind: "message",
        role: "user",
        messageId: result.messageId || createId("a2a_user_message"),
        taskId: analysisId,
        contextId,
        parts: [{ kind: "text", text: userText }],
      },
    ],
    metadata: {
      missingQuestions: result.missingQuestions ?? [],
      streamUrl: result.analysis?.streamUrl ?? null,
      explainability: "Agent trace and generated artifacts are persisted in the local conversation and analysis tables.",
    },
  };
}

function stateFrom(result: AdvisorResult): "completed" | "input-required" | "failed" {
  const status = result.analysis?.status;
  if (status === "WAITING_FOR_USER") return "input-required";
  if (status === "FAILED") return "failed";
  return "completed";
}

function outputModeFor(modes: string[]): ConversationOutputMode {
  const normalized = modes.map((mode) => mode.toLowerCase());
  if (normalized.some((mode) => mode.includes("json") || mode.includes("chart"))) return "CHART";
  if (normalized.some((mode) => mode.includes("markdown") || mode.includes("report"))) return "FINANCIAL_REPORT";
  return "SQL_ONLY";
}

function authenticate(request: NextRequest): { status: number; code: string; message: string } | null {
  const token = process.env.A2A_BEARER_TOKEN?.trim();
  if (!token) return { status: 503, code: "A2A_NOT_CONFIGURED", message: "A2A_BEARER_TOKEN is not configured." };
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() ?? "";
  if (!secureEqual(token, supplied)) return { status: 401, code: "UNAUTHENTICATED", message: "Bearer token is required." };
  return null;
}

function secureEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cleanId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160 ? value.trim() : null;
}

function titleFor(text: string): string {
  return text.replaceAll(/\s+/gu, " ").slice(0, 80) || "A2A research task";
}

function withRiskNotice(answer: string): string {
  if (/不构成|风险提示|投资建议/u.test(answer)) return answer;
  return `${answer}\n\n风险提示：以上内容仅用于研究和比赛评审，不构成投资建议、收益承诺、荐股或代客理财；请结合授权数据、个人风险承受能力和最新市场信息独立判断。`;
}

function jsonRpcContext(body: JsonRpcEnvelope | null): RpcContext {
  if (body?.jsonrpc !== "2.0") return null;
  return { id: body.id ?? null };
}

function resultForRpc(result: unknown, rpc: RpcContext): unknown {
  return rpc ? { jsonrpc: "2.0", id: rpc.id, result } : result;
}

function a2aJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "content-type": "application/a2a+json; charset=utf-8" } });
}

function a2aError(status: number, code: string, message: string, rpc: RpcContext): Response {
  const error = rpc
    ? { jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message, data: { code } } }
    : { error: { code, message } };
  return a2aJson(error, status);
}
