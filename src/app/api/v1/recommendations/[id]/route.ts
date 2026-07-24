import { NextRequest, NextResponse } from "next/server";

import { formatRecommendation } from "@/server/extensions/advisor/recommendations";
import { getDatabase, getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM recommendations WHERE id=? AND user_id=? AND status!='deleted'").get(id, getRequestContext(req).userId) as Record<string, unknown> | undefined;
  if (!row) {
    db.close();
    return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Recommendation not found" } }, { status: 404 });
  }
  const evidence = db.prepare("SELECT id,kind,title,summary,source,source_url,created_at FROM evidence_items WHERE recommendation_id=? AND user_id=? ORDER BY created_at").all(id, getRequestContext(req).userId);
  db.close();
  return NextResponse.json({ data: { ...formatRecommendation(row), evidence }, meta: meta() });
}
