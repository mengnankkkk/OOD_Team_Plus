import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void id;
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } },
    { status: 404 },
  );
}
