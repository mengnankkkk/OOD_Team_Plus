import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  void id;
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } },
    { status: 404 },
  );
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  void id;
  if (!req.headers.get("If-Match")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "If-Match header required" } },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } },
    { status: 404 },
  );
}
