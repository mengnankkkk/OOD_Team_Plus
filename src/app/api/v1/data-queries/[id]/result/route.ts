import { NextRequest, NextResponse } from "next/server";

import { ExtensionErrorCode, createExtensionError } from "@/server/extensions/errors/codes";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void id;

  const url = new URL(req.url);
  const page = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
  const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? "500", 10);
  void pageSizeRaw;

  void page;

  return NextResponse.json(
    {
      error: createExtensionError(
        ExtensionErrorCode.RESOURCE_NOT_FOUND,
        "Data query not found",
      ),
    },
    { status: 404 },
  );
}
