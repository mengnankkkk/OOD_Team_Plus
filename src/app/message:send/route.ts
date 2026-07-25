import { NextRequest } from "next/server";

import { handleSendMessage } from "@/server/a2a/message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleSendMessage(request);
}
