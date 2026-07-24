import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";
import { evaluateRiskAssessment } from "@/lib/risk-assessment";

const Schema = z.object({ answers: z.record(z.string(), z.string()) });

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "answers required" } }, { status: 400 });
  const assessment = evaluateRiskAssessment(parsed.data.answers);
  if (assessment.missingQuestionIds.length > 0) {
    return NextResponse.json({ error: { code: "QUESTIONNAIRE_INCOMPLETE", message: "请完成全部风险测评题目", details: { missingQuestionIds: assessment.missingQuestionIds } } }, { status: 422 });
  }
  const db = getDatabase();
  db.prepare("INSERT INTO risk_assessments (id, user_id, answers_json, risk_level, score, conflicts_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(createId("risk"), getRequestContext(req).userId, JSON.stringify(parsed.data.answers), assessment.riskLevel, assessment.score, JSON.stringify(assessment.conflicts), isoNow());
  db.prepare("INSERT INTO user_profiles (id, user_id, risk_level, preferences_json, status, created_at, updated_at) VALUES (?, ?, ?, '{}', 'draft', ?, ?) ON CONFLICT(user_id) DO UPDATE SET risk_level=excluded.risk_level, updated_at=excluded.updated_at, version=user_profiles.version+1").run(createId("profile"), getRequestContext(req).userId, assessment.riskLevel, isoNow(), isoNow());
  db.close();
  return NextResponse.json({ data: { ...assessment, conflicts: assessment.conflicts }, meta: meta() }, { status: 201 });
}
