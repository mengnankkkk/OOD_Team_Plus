import { MissingEnvironmentError } from "@/server/chat/environment";
import { ZodError } from "zod";

export function jsonError(error: unknown) {
  if (error instanceof MissingEnvironmentError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: 503 },
    );
  }

  if (error instanceof ZodError || error instanceof SyntaxError) {
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: "请求格式无效，请检查后重试。" } },
      { status: 400 },
    );
  }

  return Response.json(
    { error: { code: "SERVICE_UNAVAILABLE", message: "对话服务暂时不可用，请稍后重试。" } },
    { status: 502 },
  );
}

export function sanitizeStreamError() {
  return "对话服务暂时不可用，请稍后重试。";
}
