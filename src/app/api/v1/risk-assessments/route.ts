import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

const Schema = z.object({ answers: z.record(z.string(), z.string()) });

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "answers required" } }, { status: 400 });
  const score = Object.values(parsed.data.answers).reduce((sum, value) => sum + (value === "sell" || value === "low" ? 1 : value === "reduce" || value === "medium" ? 2 : 3), 0);
  const riskLevel = score <= 4 ? "CONSERVATIVE" : score <= 7 ? "BALANCED" : "AGGRESSIVE";
  const db = getDatabase();
  db.prepare("INSERT INTO risk_assessments (id, user_id, answers_json, risk_level, score, conflicts_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(createId("risk"), getRequestContext(req).userId, JSON.stringify(parsed.data.answers), riskLevel, score, "[]", isoNow());
  db.prepare("INSERT INTO user_profiles (id, user_id, risk_level, preferences_json, status, created_at, updated_at) VALUES (?, ?, ?, '{}', 'draft', ?, ?) ON CONFLICT(user_id) DO UPDATE SET risk_level=excluded.risk_level, updated_at=excluded.updated_at, version=user_profiles.version+1").run(createId("profile"), getRequestContext(req).userId, riskLevel, isoNow(), isoNow());
  db.close();
  return NextResponse.json({ data: { riskLevel, score, recommendedMaxEquityWeight: riskLevel === "CONSERVATIVE" ? 0.4 : riskLevel === "BALANCED" ? 0.7 : 1, conflicts: [] }, meta: meta() }, { status: 201 });
}
