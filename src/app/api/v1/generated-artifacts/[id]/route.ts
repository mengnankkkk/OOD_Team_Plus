import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

const notFound = () =>
  NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Artifact not found" } },
    { status: 404 },
  );

export async function GET(_req: NextRequest, _context: RouteContext) {
  return notFound();
}

export async function PATCH(req: NextRequest, _context: RouteContext) {
  if (!req.headers.get("If-Match")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "If-Match required" } },
      { status: 400 },
    );
  }

  // A persisted artifact edit will create a new immutable version.
  return notFound();
}

export async function DELETE(req: NextRequest, _context: RouteContext) {
  if (!req.headers.get("If-Match")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "If-Match required" } },
      { status: 400 },
    );
  }

  return notFound();
}
