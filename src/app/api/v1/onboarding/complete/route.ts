import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authError } from "@/server/auth/http";
import { createId, getDatabase, getRequestContext, isoNow, meta, parseJson } from "@/server/http/context";
import { evaluateRiskAssessment, horizonFromAnswer, maxDrawdownFromAnswer } from "@/lib/risk-assessment";

const decimalString = z.string().trim().min(1).refine((value) => /^\d+(\.\d{1,2})?$/u.test(value), "请输入有效金额");

const Schema = z.object({
  answers: z.record(z.string(), z.string()),
  profile: z.object({
    displayName: z.string().trim().max(60).optional(),
    age: z.number().int().min(18).max(100).nullable().optional(),
    household: z.string().trim().max(120).nullable().optional(),
    monthlyIncome: decimalString,
    monthlyExpense: decimalString,
    liabilities: decimalString,
    emergencyTargetMonths: z.number().int().min(1).max(36),
    investmentAmount: decimalString,
    horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).optional(),
    maxDrawdown: decimalString.optional(),
  }),
  goal: z.object({
    name: z.string().trim().min(1).max(120),
    targetAmount: decimalString,
    targetDate: z.string().trim().min(1),
    priority: z.enum(["1", "2", "3", "4", "5"]),
    assetPreference: z.enum(["STOCK", "SECTOR", "INDEX"]),
  }),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "请完整填写建档信息", details: parsed.error.format() } }, { status: 400 });
  }

  const assessment = evaluateRiskAssessment(parsed.data.answers);
  if (assessment.missingQuestionIds.length > 0) {
    return NextResponse.json({
      error: {
        code: "QUESTIONNAIRE_INCOMPLETE",
        message: "请完成全部风险测评题目",
        details: { missingQuestionIds: assessment.missingQuestionIds },
      },
    }, { status: 422 });
  }

  let db: ReturnType<typeof getDatabase> | null = null;
  let goalId: string | null = null;

  try {
    const { userId } = getRequestContext(req);
    db = getDatabase();
    const database = db;
    const now = isoNow();
    const transaction = database.transaction(() => {
      const currentProfile = database.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
      const currentPreferences = parseJson<Record<string, unknown>>(String(currentProfile?.preferences_json ?? "{}"), {});
      const preferencePatch = {
        ...currentPreferences,
        displayName: parsed.data.profile.displayName ?? currentPreferences.displayName ?? "",
        age: parsed.data.profile.age ?? currentPreferences.age ?? null,
        household: parsed.data.profile.household ?? currentPreferences.household ?? null,
        monthlyIncome: Number(parsed.data.profile.monthlyIncome),
        monthlyExpense: Number(parsed.data.profile.monthlyExpense),
        liabilities: Number(parsed.data.profile.liabilities),
        emergencyTargetMonths: parsed.data.profile.emergencyTargetMonths,
        riskSubjective: assessment.willingnessLevel,
        riskCapacity: assessment.capacityLevel,
        onboardingCompleted: true,
        onboardingVersion: 1,
      };

      database.prepare("INSERT INTO risk_assessments (id, user_id, answers_json, risk_level, score, conflicts_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(createId("risk"), userId, JSON.stringify(parsed.data.answers), assessment.riskLevel, assessment.score, JSON.stringify(assessment.conflicts), now);

      database.prepare(`INSERT INTO user_profiles
        (id, user_id, risk_level, investment_amount_decimal, horizon, max_drawdown_decimal, preferences_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          risk_level=excluded.risk_level,
          investment_amount_decimal=excluded.investment_amount_decimal,
          horizon=excluded.horizon,
          max_drawdown_decimal=excluded.max_drawdown_decimal,
          preferences_json=excluded.preferences_json,
          status='complete',
          version=user_profiles.version+1,
          updated_at=excluded.updated_at`)
        .run(
          createId("profile"),
          userId,
          assessment.riskLevel,
          parsed.data.profile.investmentAmount,
          parsed.data.profile.horizon ?? horizonFromAnswer(parsed.data.answers.holding_horizon),
          parsed.data.profile.maxDrawdown ?? maxDrawdownFromAnswer(parsed.data.answers.max_drawdown),
          JSON.stringify(preferencePatch),
          now,
          now,
        );

      const existingGoal = database.prepare("SELECT id FROM goals WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1").get(userId) as { id?: string } | undefined;
      goalId = existingGoal?.id ?? createId("goal");
      if (existingGoal?.id) {
        database.prepare("UPDATE goals SET name=?, target_amount_decimal=?, target_date=?, horizon=?, priority=?, asset_preference=?, updated_at=?, version=version+1 WHERE id=? AND user_id=?")
          .run(parsed.data.goal.name, parsed.data.goal.targetAmount, parsed.data.goal.targetDate, parsed.data.profile.horizon ?? horizonFromAnswer(parsed.data.answers.holding_horizon), parsed.data.goal.priority, parsed.data.goal.assetPreference, now, existingGoal.id, userId);
      } else {
        database.prepare("INSERT INTO goals (id,user_id,name,target_amount_decimal,target_date,horizon,priority,asset_preference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(goalId, userId, parsed.data.goal.name, parsed.data.goal.targetAmount, parsed.data.goal.targetDate, parsed.data.profile.horizon ?? horizonFromAnswer(parsed.data.answers.holding_horizon), parsed.data.goal.priority, parsed.data.goal.assetPreference, now, now);
      }
    });

    transaction();
    return NextResponse.json({
      data: {
        status: "COMPLETE",
        riskLevel: assessment.riskLevel,
        riskLabel: assessment.riskLabel,
        score: assessment.score,
        capacityLevel: assessment.capacityLevel,
        willingnessLevel: assessment.willingnessLevel,
        recommendedMaxEquityWeight: assessment.recommendedMaxEquityWeight,
        conflicts: assessment.conflicts,
        goalId,
      },
      meta: meta(),
    }, { status: 201 });
  } catch (error) {
    return authError(error);
  } finally {
    db?.close();
  }
}
