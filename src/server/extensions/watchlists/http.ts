import { NextRequest, NextResponse } from "next/server";

import { WatchlistDomainError } from "./types";

export function domainResponse(error: unknown): NextResponse {
  if (error instanceof WatchlistDomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  throw error;
}

export function parseVersion(request: NextRequest): number | null {
  const value = Number.parseInt(request.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function invalid(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: { code: "INVALID_REQUEST", message, details } }, { status: 400 });
}
