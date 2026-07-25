import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authError } from "@/server/auth/http";
import { syncPortfolioFromHoldings } from "@/server/extensions/analysis/service";
import { createId, getDatabase, getRequestContext, isoNow, meta, parseJson } from "@/server/http/context";
import { evaluateRiskAssessment, horizonFromAnswer, maxDrawdownFromAnswer } from "@/lib/risk-assessment";

const decimalInput = z.union([z.string(), z.number()])
  .transform(normalizeDecimalInput)
  .refine((value) => /^\d+(\.\d{1,2})?$/u.test(value), "请输入有效金额");
const optionalDecimalInput = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? undefined : value,
  decimalInput.optional(),
);
const optionalAge = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? null : Number(value),
  z.number().int().min(18).max(100).nullable().optional(),
);

const portfolioInput = z.object({
  id: z.string().trim().min(1).max(80).default("portfolio-demo"),
  holdings: z.array(z.object({
    instrumentId: z.string().trim().min(1),
    quantity: decimalInput.refine((value) => Number(value) > 0, "持有数量必须大于 0"),
    cost: decimalInput,
  })).min(1, "请至少填写一笔当前持仓").max(50),
}).superRefine((portfolio, ctx) => {
  const ids = portfolio.holdings.map((holding) => holding.instrumentId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["holdings"], message: "同一标的请合并为一笔持仓" });
  }
});

const onboardingInput = z.object({
  answers: z.record(z.string(), z.string()),
  profile: z.object({
    displayName: z.string().trim().max(60).optional(),
    age: optionalAge,
    household: z.string().trim().max(120).nullable().optional(),
    monthlyIncome: decimalInput,
    monthlyExpense: decimalInput,
    liabilities: decimalInput,
    emergencyTargetMonths: z.coerce.number().int().min(1).max(36),
    investmentAmount: decimalInput,
    horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).optional(),
    maxDrawdown: optionalDecimalInput,
  }),
  goal: z.object({
    name: z.string().trim().min(1).max(120),
    targetAmount: decimalInput,
    targetDate: z.string().trim().min(1),
    priority: z.enum(["1", "2", "3", "4", "5"]),
    assetPreference: z.enum(["STOCK", "SECTOR", "INDEX"]),
  }),
  portfolio: portfolioInput.optional(),
});
const Schema = z.union([onboardingInput, z.object({ portfolio: portfolioInput })]);

function normalizeDecimalInput(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return value.trim().replace(/[,\s，￥¥元]/gu, "");
}

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "请完整填写建档信息", details: parsed.error.format() } }, { status: 400 });
  }

  const onboarding = "answers" in parsed.data ? parsed.data : null;
  const portfolio = parsed.data.portfolio;
  const assessment = onboarding ? evaluateRiskAssessment(onboarding.answers) : null;
  if (assessment?.missingQuestionIds.length) {
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
  const portfolioId = portfolio?.id ?? null;

  try {
    const { userId } = getRequestContext(req);
    db = getDatabase();
    const database = db;
    const now = isoNow();
    if (portfolio) {
      const instrumentIds = portfolio.holdings.map((holding) => holding.instrumentId);
      const placeholders = instrumentIds.map(() => "?").join(",");
      const available = database.prepare(`SELECT id FROM instruments WHERE tradable=1 AND id IN (${placeholders})`)
        .all(...instrumentIds) as Array<{ id: string }>;
      if (available.length !== instrumentIds.length) {
        const availableIds = new Set(available.map((instrument) => instrument.id));
        return NextResponse.json({
          error: {
            code: "INVALID_PORTFOLIO_INSTRUMENT",
            message: "组合中包含不可交易或不存在的标的",
            details: { instrumentIds: instrumentIds.filter((id) => !availableIds.has(id)) },
          },
        }, { status: 422 });
      }
    }

    const transaction = database.transaction(() => {
      if (onboarding && assessment) {
        const currentProfile = database.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
        const currentPreferences = parseJson<Record<string, unknown>>(String(currentProfile?.preferences_json ?? "{}"), {});
        const preferencePatch = {
          ...currentPreferences,
          displayName: onboarding.profile.displayName ?? currentPreferences.displayName ?? "",
          age: onboarding.profile.age ?? currentPreferences.age ?? null,
          household: onboarding.profile.household ?? currentPreferences.household ?? null,
          monthlyIncome: Number(onboarding.profile.monthlyIncome),
          monthlyExpense: Number(onboarding.profile.monthlyExpense),
          liabilities: Number(onboarding.profile.liabilities),
          emergencyTargetMonths: onboarding.profile.emergencyTargetMonths,
          riskSubjective: assessment.willingnessLevel,
          riskCapacity: assessment.capacityLevel,
          instrumentPreference: onboarding.goal.assetPreference,
          nearTermUse: onboarding.answers.near_term_use !== "not_needed",
          onboardingCompleted: true,
          onboardingVersion: 1,
        };

        database.prepare("INSERT INTO risk_assessments (id, user_id, answers_json, risk_level, score, conflicts_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(createId("risk"), userId, JSON.stringify(onboarding.answers), assessment.riskLevel, assessment.score, JSON.stringify(assessment.conflicts), now);

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
            onboarding.profile.investmentAmount,
            onboarding.profile.horizon ?? horizonFromAnswer(onboarding.answers.holding_horizon),
            onboarding.profile.maxDrawdown ?? maxDrawdownFromAnswer(onboarding.answers.max_drawdown),
            JSON.stringify(preferencePatch),
            now,
            now,
          );

        const existingGoal = database.prepare("SELECT id FROM goals WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1").get(userId) as { id?: string } | undefined;
        goalId = existingGoal?.id ?? createId("goal");
        if (existingGoal?.id) {
          database.prepare("UPDATE goals SET name=?, target_amount_decimal=?, target_date=?, horizon=?, priority=?, asset_preference=?, updated_at=?, version=version+1 WHERE id=? AND user_id=?")
            .run(onboarding.goal.name, onboarding.goal.targetAmount, onboarding.goal.targetDate, onboarding.profile.horizon ?? horizonFromAnswer(onboarding.answers.holding_horizon), onboarding.goal.priority, onboarding.goal.assetPreference, now, existingGoal.id, userId);
        } else {
          database.prepare("INSERT INTO goals (id,user_id,name,target_amount_decimal,target_date,horizon,priority,asset_preference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
            .run(goalId, userId, onboarding.goal.name, onboarding.goal.targetAmount, onboarding.goal.targetDate, onboarding.profile.horizon ?? horizonFromAnswer(onboarding.answers.holding_horizon), onboarding.goal.priority, onboarding.goal.assetPreference, now, now);
        }
      }

      if (portfolio) {
        for (const holding of portfolio.holdings) {
          const existing = database.prepare(`
            SELECT id FROM holdings
            WHERE user_id=? AND portfolio_id=? AND instrument_id=?
            ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, updated_at DESC
            LIMIT 1
          `).get(userId, portfolio.id, holding.instrumentId) as { id?: string } | undefined;
          if (existing?.id) {
            database.prepare("UPDATE holdings SET quantity_decimal=?, cost_decimal=?, status='active', version=version+1, updated_at=? WHERE id=? AND user_id=?")
              .run(holding.quantity, holding.cost, now, existing.id, userId);
          } else {
            database.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?)")
              .run(createId("holding"), userId, portfolio.id, holding.instrumentId, holding.quantity, holding.cost, now, now);
          }
        }
      }
    });

    transaction();
    if (portfolioId) {
      database.close();
      db = null;
      syncPortfolioFromHoldings(userId, portfolioId);
    }
    return NextResponse.json({
      data: {
        status: "COMPLETE",
        ...(assessment ? {
          riskLevel: assessment.riskLevel,
          riskLabel: assessment.riskLabel,
          score: assessment.score,
          capacityLevel: assessment.capacityLevel,
          willingnessLevel: assessment.willingnessLevel,
          recommendedMaxEquityWeight: assessment.recommendedMaxEquityWeight,
          conflicts: assessment.conflicts,
        } : {}),
        goalId,
        portfolioId,
        holdingCount: portfolio?.holdings.length ?? 0,
      },
      meta: meta(),
    }, { status: 201 });
  } catch (error) {
    return authError(error);
  } finally {
    db?.close();
  }
}
