import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

export async function GET(req: NextRequest) { const db = getDatabase(); const rows = db.prepare("SELECT * FROM decision_logs WHERE user_id=? ORDER BY created_at DESC LIMIT ?").all(getRequestContext(req).userId, Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 100)) as Array<Record<string, unknown>>; db.close(); return NextResponse.json({ data: { items: rows.map((row) => ({ id: row.id, action: row.action, decision: row.decision, recommendation: parseJson(row.recommendation_json as string, {}), createdAt: row.created_at })) }, meta: meta() }); }
