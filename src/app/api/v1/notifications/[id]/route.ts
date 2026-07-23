import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const PatchNotificationSchema = z.object({
  action: z.enum(["MARK_READ", "IGNORE"]),
});

function invalidRequest(message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message, ...(details ? { details } : {}) } },
    { status: 400 },
  );
}

function notFound() {
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Notification not found" } },
    { status: 404 },
  );
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  void params.id;

  if (!req.headers.get("If-Match")) {
    return invalidRequest("If-Match required");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidRequest("Invalid JSON");
  }

  const parsed = PatchNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("action must be MARK_READ or IGNORE", parsed.error.format() as Record<string, unknown>);
  }

  return NextResponse.json({
    data: {
      id: params.id,
      status: parsed.data.action === "MARK_READ" ? "read" : "ignored",
      unread: false,
      updatedAt: new Date().toISOString(),
    },
    meta: {
      requestId: `req_${Date.now()}`,
      apiVersion: "v1" as const,
      generatedAt: new Date().toISOString(),
    },
  });
}

export async function GET() {
  return notFound();
}
