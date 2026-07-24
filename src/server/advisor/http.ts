import { ZodError } from "zod";
import { getIdempotentResponse, requestHash, saveIdempotentResponse } from "@/server/advisor/idempotency";
import type { AdvisorDatabase } from "@/server/advisor/database";

export class AdvisorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AdvisorError";
  }
}

export function apiResponse(data: unknown, status = 200, extraMeta: Record<string, unknown> = {}) {
  return Response.json(
    {
      data,
      meta: {
        requestId: crypto.randomUUID(),
        apiVersion: "v1",
        generatedAt: new Date().toISOString(),
        ...extraMeta,
      },
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function advisorJsonError(error: unknown) {
  if (error instanceof AdvisorError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "请求参数不合法。" } },
      { status: 422 },
    );
  }
  const message = error instanceof Error ? error.message : "";
  const mapped = mapKnownError(message);
  if (mapped) return Response.json({ error: mapped.body }, { status: mapped.status });
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "对话 Agent 暂时不可用。" } },
    { status: 500 },
  );
}

export async function idempotentApiResponse(
  request: Request,
  database: AdvisorDatabase,
  userId: string,
  operation: string,
  input: unknown,
  handler: () => Promise<{ data: unknown; status?: number }> | { data: unknown; status?: number },
) {
  const key = request.headers.get("Idempotency-Key");
  if (key && key.length > 128) throw new AdvisorError("BAD_REQUEST", "Idempotency-Key 不能超过 128 个字符。", 400);
  const hash = requestHash(input);
  const existing = getIdempotentResponse(database, userId, operation, key);
  if (existing) {
    if (existing.requestHash !== hash) throw new AdvisorError("IDEMPOTENCY_CONFLICT", "相同幂等键对应了不同请求。", 409);
    return new Response(JSON.stringify(existing.body), {
      status: existing.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const result = await handler();
  const response = apiResponse(result.data, result.status ?? 200);
  if (key) {
    const body = await response.clone().json();
    saveIdempotentResponse(database, userId, operation, key, body, result.status ?? 200, hash);
  }
  return response;
}

export function notFound(message = "资源不存在。") {
  return Response.json({ error: { code: "RESOURCE_NOT_FOUND", message } }, { status: 404 });
}

export function expectedVersion(request: Request) {
  const raw = request.headers.get("If-Match")?.replaceAll('"', "");
  return raw ? Number(raw) : undefined;
}

function mapKnownError(message: string) {
  const map: Record<string, { status: number; text: string }> = {
    RESOURCE_NOT_FOUND: { status: 404, text: "资源不存在。" },
    VERSION_CONFLICT: { status: 412, text: "资源版本已变化，请刷新后重试。" },
    ASSET_NOT_TRADABLE: { status: 422, text: "该标的不可直接建立持仓。" },
    PARSE_ALREADY_CONFIRMED: { status: 409, text: "持仓草稿已经确认或失效。" },
    HOLDING_CONFIRMATION_REQUIRED: { status: 422, text: "必须确认至少一个持仓候选。" },
    HOLDING_CANDIDATE_NOT_FOUND: { status: 422, text: "持仓候选已失效，请重新解析。" },
    HOLDING_INSTRUMENT_REQUIRED: { status: 422, text: "请先选择具体证券或基金。" },
    INDEX_HOLDING_MAPPING_REQUIRED: { status: 422, text: "指数不能直接按股建立持仓，请选择对应 ETF 并重新填写数量和成本价。" },
    INDEX_PRICE_REENTRY_REQUIRED: { status: 422, text: "指数点位不能直接当作 ETF 价格，请重新填写 ETF 的实际持仓数量和买入均价。" },
    CLARIFICATION_ALREADY_ANSWERED: { status: 409, text: "该追问已经回答。" },
    PROFILE_INCOMPLETE: { status: 422, text: "用户画像尚未完成。" },
    RUN_ALREADY_ACTIVE: { status: 409, text: "当前会话已有运行中的分析。" },
    IDEMPOTENCY_CONFLICT: { status: 409, text: "相同幂等键对应了不同请求。" },
    DECISION_CONFLICT: { status: 409, text: "当前建议状态不允许记录该决策。" },
    ANALYSIS_CANCELLED: { status: 409, text: "分析已取消。" },
    ANALYSIS_NOT_RETRYABLE: { status: 409, text: "当前分析没有可重试的用户问题。" },
    INVALIDATION_REQUIRED: { status: 422, text: "缺少建议失效条件。" },
  };
  const item = map[message];
  return item ? { status: item.status, body: { code: message, message: item.text } } : null;
}
