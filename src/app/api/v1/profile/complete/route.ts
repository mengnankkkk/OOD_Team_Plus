import { NextRequest, NextResponse } from "next/server";
import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function POST(req: NextRequest) {
  const db = getDatabase();
  const userId = getRequestContext(req).userId;
  const profile = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  const goalCount = Number((db.prepare("SELECT COUNT(*) AS count FROM goals WHERE user_id = ? AND status = 'active'").get(userId) as { count?: number } | undefined)?.count ?? 0);
  if (!profile || !profile.risk_level || !profile.investment_amount_decimal || !profile.horizon || goalCount === 0) { db.close(); return NextResponse.json({ error: { code: "PROFILE_INCOMPLETE", message: "Risk level, investment amount, horizon and at least one goal are required" } }, { status: 422 }); }
  db.prepare("UPDATE user_profiles SET status = 'complete', updated_at = ?, version = version + 1 WHERE user_id = ?").run(isoNow(), userId);
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  db.close();
  if (!row) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Profile not found" } }, { status: 404 });
  return NextResponse.json({ data: { status: "COMPLETE", effectiveRiskLevel: row.risk_level, version: row.version }, meta: meta() });
}
