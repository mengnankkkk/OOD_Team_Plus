import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

export const A2A_SERVICE_USER_ID = "a2a-remote-agent";

export type A2AAuthFailure = {
  status: number;
  code: string;
  message: string;
};

export function authenticateA2A(request: NextRequest): A2AAuthFailure | null {
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
