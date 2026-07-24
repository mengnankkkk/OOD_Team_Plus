import { NextRequest, NextResponse } from "next/server";
import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function POST(req: NextRequest) {
  const db = getDatabase();
  const userId = getRequestContext(req).userId;
  const profile = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  if (!profile || !profile.risk_level || !profile.investment_amount_decimal || !profile.horizon) { db.close(); return NextResponse.json({ error: { code: "PROFILE_INCOMPLETE", message: "Risk level, investment amount and horizon are required" } }, { status: 422 }); }
  db.prepare("UPDATE user_profiles SET status = 'complete', updated_at = ?, version = version + 1 WHERE user_id = ?").run(isoNow(), userId);
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  db.close();
  if (!row) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Profile not found" } }, { status: 404 });
  return NextResponse.json({ data: { status: "COMPLETE", effectiveRiskLevel: row.risk_level, version: row.version }, meta: meta() });
}
