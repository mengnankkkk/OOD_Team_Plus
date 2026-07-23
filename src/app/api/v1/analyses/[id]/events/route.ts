import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lastEventId = req.headers.get("Last-Event-ID");
  const { id } = await params;
  void id;
  void lastEventId;

  return new Response('data: {"type":"connected"}\n\n', {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
