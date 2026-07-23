import { NextRequest, NextResponse } from "next/server";

import { ExtensionErrorCode, createExtensionError } from "@/server/extensions/errors/codes";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  void params.id;

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
