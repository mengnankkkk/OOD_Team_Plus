import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, _context: RouteContext) {
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Artifact not found" } },
    { status: 404 },
  );
}
