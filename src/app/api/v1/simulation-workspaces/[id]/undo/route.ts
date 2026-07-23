import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  void params.id;
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } },
    { status: 404 },
  );
}
