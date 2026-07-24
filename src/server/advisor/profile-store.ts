import type { AdvisorDatabase } from "@/server/advisor/database";
import { GoalStore } from "@/server/advisor/goal-store";
import { InstrumentStore } from "@/server/advisor/instrument-store";
import { json, newId, nowIso, parseJson, runValue, runWrite } from "@/server/advisor/store-common";

export type { InstrumentRecord } from "@/server/advisor/instrument-store";
export type { GoalRecord } from "@/server/advisor/goal-store";

export type UserRecord = {
  id: string;
  displayName: string;
  locale: string;
  timezone: string;
  baseCurrency: string;
  isDemo: boolean;
};

export type ProfileRecord = {
  id: string;
  userId: string;
  status: "DRAFT" | "COMPLETE";
  investableCapital?: string;
  monthlyContribution?: string;
  nearTermCashNeed?: string;
  subjectiveRiskPreference?: string;
  objectiveRiskCapacity?: string;
  effectiveRiskLevel?: string;
  maxAcceptableDrawdown?: number;
  maxEquityWeight?: number;
  maxSinglePositionWeight?: number;
  maxSectorWeight?: number;
  instrumentPreferences: string[];
  tags: string[];
  version: number;
};

export class ProfileStore {
  readonly instruments: InstrumentStore;
  readonly goals: GoalStore;

  constructor(private readonly database: AdvisorDatabase) {
    this.instruments = new InstrumentStore(database);
    this.goals = new GoalStore(database);
  }

  getUser(userId: string) {
    const row = runValue<{ id: string; display_name: string; locale: string; timezone: string; base_currency: string; is_demo: number }>(
      this.database,
      "SELECT * FROM users WHERE id = ?",
      userId,
    );
    return row
      ? {
          id: row.id,
          displayName: row.display_name,
          locale: row.locale,
          timezone: row.timezone,
          baseCurrency: row.base_currency,
          isDemo: row.is_demo === 1,
        }
      : null;
  }

  getProfile(userId: string): ProfileRecord | null {
    const row = runValue<Record<string, unknown>>(this.database, "SELECT * FROM user_profiles WHERE user_id = ?", userId);
    if (!row) return null;
    return {
      id: String(row.id),
      userId,
      status: row.status === "complete" ? "COMPLETE" : "DRAFT",
      investableCapital: row.monthly_investable_minor == null ? undefined : String(Number(row.monthly_investable_minor) / 100),
      monthlyContribution: row.monthly_contribution_minor == null ? undefined : String(Number(row.monthly_contribution_minor) / 100),
      nearTermCashNeed: row.near_term_cash_need_minor == null ? undefined : String(Number(row.near_term_cash_need_minor) / 100),
      subjectiveRiskPreference: upper(row.subjective_risk_preference),
      objectiveRiskCapacity: upper(row.objective_risk_capacity),
      effectiveRiskLevel: upper(row.effective_risk_level),
      maxAcceptableDrawdown: numberOrUndefined(row.max_acceptable_drawdown),
      maxEquityWeight: numberOrUndefined(row.max_equity_weight),
      maxSinglePositionWeight: numberOrUndefined(row.max_single_position_weight),
      maxSectorWeight: numberOrUndefined(row.max_sector_weight),
      instrumentPreferences: parseJson(row.instrument_preferences_json, []),
      tags: parseJson(row.tags_json, []),
      version: Number(row.version),
    };
  }

  patchProfile(userId: string, patch: Record<string, unknown>) {
    const current = this.getProfile(userId);
    if (!current) throw new Error("PROFILE_NOT_FOUND");
    const version = current.version + 1;
    const money = (key: string) => patch[key] == null ? null : Math.round(Number(patch[key]) * 100);
    runWrite(
      this.database,
      `UPDATE user_profiles SET
       monthly_investable_minor = COALESCE(?, monthly_investable_minor),
       monthly_contribution_minor = COALESCE(?, monthly_contribution_minor),
       monthly_expense_minor = COALESCE(?, monthly_expense_minor),
       near_term_cash_need_minor = COALESCE(?, near_term_cash_need_minor),
       subjective_risk_preference = COALESCE(?, subjective_risk_preference),
       instrument_preferences_json = COALESCE(?, instrument_preferences_json),
       max_acceptable_drawdown = COALESCE(?, max_acceptable_drawdown),
       notes = COALESCE(?, notes), version = ?, updated_at = ? WHERE user_id = ?`,
      money("investableCapital"),
      money("monthlyContribution"),
      money("monthlyExpenses"),
      money(patch.nearTermCashNeed == null ? "nearTermLiquidityNeed" : "nearTermCashNeed"),
      lower(patch.subjectiveRiskPreference),
      patch.instrumentPreferences ? json(patch.instrumentPreferences) : null,
      patch.maxAcceptableDrawdown ?? null,
      patch.notes ?? null,
      version,
      nowIso(),
      userId,
    );
    return this.getProfile(userId)!;
  }

  saveRiskAssessment(userId: string, assessment: Record<string, unknown>) {
    const id = newId("risk");
    const createdAt = nowIso();
    runWrite(this.database, "UPDATE risk_assessments SET is_current = 0 WHERE user_id = ?", userId);
    runWrite(
      this.database,
      `INSERT INTO risk_assessments
       (id, user_id, questionnaire_version, subjective_risk_preference, objective_risk_capacity,
        effective_risk_level, subjective_score, capacity_score, max_acceptable_drawdown,
        max_equity_weight, max_single_position_weight, max_sector_weight, liquidity_need_level,
        conflict_detected, conflict_summary, answers_json, is_current, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      userId,
      assessment.questionnaireVersion,
      lower(assessment.subjectiveRiskPreference),
      lower(assessment.objectiveRiskCapacity),
      lower(assessment.effectiveRiskLevel),
      assessment.subjectiveScore,
      assessment.capacityScore,
      assessment.maxAcceptableDrawdown,
      assessment.maxEquityWeight,
      assessment.maxSinglePositionWeight,
      assessment.maxSectorWeight,
      assessment.liquidityNeedLevel ?? "medium",
      assessment.conflictDetected ? 1 : 0,
      assessment.conflictSummary ?? null,
      json(assessment.answers ?? []),
      createdAt,
      createdAt,
    );
    runWrite(
      this.database,
      `UPDATE user_profiles SET status = 'complete', subjective_risk_preference = ?, objective_risk_capacity = ?,
       effective_risk_level = ?, max_acceptable_drawdown = ?, max_equity_weight = ?,
       max_single_position_weight = ?, max_sector_weight = ?, version = version + 1, updated_at = ?
       WHERE user_id = ?`,
      lower(assessment.subjectiveRiskPreference),
      lower(assessment.objectiveRiskCapacity),
      lower(assessment.effectiveRiskLevel),
      assessment.maxAcceptableDrawdown,
      assessment.maxEquityWeight,
      assessment.maxSinglePositionWeight,
      assessment.maxSectorWeight,
      createdAt,
      userId,
    );
    return { id, status: "COMPLETED", ...assessment };
  }

  listGoals(userId: string) {
    return this.goals.list(userId);
  }

  createGoal(userId: string, input: Record<string, unknown>) {
    return this.goals.create(userId, input);
  }

  updateGoal(userId: string, goalId: string, patch: Record<string, unknown>, expectedVersion?: number) {
    return this.goals.update(userId, goalId, patch, expectedVersion);
  }

  deleteGoal(userId: string, goalId: string) {
    return this.goals.remove(userId, goalId);
  }

  searchInstruments(query: string, assetType?: string) {
    return this.instruments.search(query, assetType);
  }

  getInstrument(idOrSymbol: string) {
    return this.instruments.get(idOrSymbol);
  }

  upsertInstrument(input: Record<string, unknown>) {
    return this.instruments.upsert(input);
  }
}

function upper(value: unknown) {
  return value == null ? undefined : String(value).toUpperCase();
}

function lower(value: unknown) {
  return value == null ? null : String(value).toLowerCase();
}

function numberOrUndefined(value: unknown) {
  return value == null ? undefined : Number(value);
}
