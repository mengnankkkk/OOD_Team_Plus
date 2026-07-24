import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void id;
  if (!req.headers.get("If-Match")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "If-Match required" } },
      { status: 400 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  if (
    typeof body !== "object" ||
    body === null ||
    !("branchId" in body) ||
    typeof body.branchId !== "string" ||
    body.branchId.length === 0
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "branchId required" } },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } },
    { status: 404 },
  );
}
