import type { AdvisorDatabase } from "@/server/advisor/database";
import { newId, nowIso, runRows, runWrite } from "@/server/advisor/store-common";

export type GoalRecord = {
  id: string;
  userId: string;
  name: string;
  targetAmount: string;
  initialInvestmentAmount: string;
  monthlyContributionAmount: string;
  horizon: string;
  targetDate: string | null;
  priority: number;
  instrumentPreferences: string[];
  status: string;
  version: number;
};

export class GoalStore {
  constructor(private readonly database: AdvisorDatabase) {}

  list(userId: string) {
    return runRows<Record<string, unknown>>(this.database, "SELECT * FROM user_goals WHERE user_id = ? ORDER BY priority, created_at", userId).map(
      (row) => ({
        id: String(row.id),
        userId,
        name: String(row.name),
        targetAmount: money(row.target_amount_minor),
        initialInvestmentAmount: money(row.initial_investable_minor),
        monthlyContributionAmount: money(row.monthly_contribution_minor),
        horizon: upper(row.horizon),
        targetDate: row.target_date as string | null,
        priority: Number(row.priority),
        instrumentPreferences: this.preferences(String(row.id)),
        status: upper(row.status),
        version: Number(row.version),
      }),
    );
  }

  create(userId: string, input: Record<string, unknown>) {
    const id = newId("goal");
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO user_goals
       (id, user_id, name, goal_type, target_amount_minor, current_reserved_minor,
        initial_investable_minor, monthly_contribution_minor, currency, target_date, horizon,
        priority, capital_preservation_required, status, notes, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'CNY', ?, ?, ?, ?, 'active', ?, 1, ?, ?)`,
      id,
      userId,
      input.name,
      input.goalType ?? "wealth_growth",
      Math.round(Number(input.targetAmount) * 100),
      Math.round(Number(input.initialInvestmentAmount ?? 0) * 100),
      Math.round(Number(input.monthlyContributionAmount ?? 0) * 100),
      input.targetDate ?? null,
      lower(input.horizon ?? "long"),
      input.priority ?? 1,
      input.capitalPreservationRequired ? 1 : 0,
      input.notes ?? null,
      timestamp,
      timestamp,
    );
    this.replacePreferences(id, input.instrumentPreferences);
    return this.list(userId).find((goal) => goal.id === id)!;
  }

  update(userId: string, goalId: string, patch: Record<string, unknown>, expectedVersion?: number) {
    const goal = this.list(userId).find((item) => item.id === goalId);
    if (!goal) return null;
    if (expectedVersion != null && goal.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
    runWrite(
      this.database,
      `UPDATE user_goals SET target_amount_minor = COALESCE(?, target_amount_minor),
       monthly_contribution_minor = COALESCE(?, monthly_contribution_minor), priority = COALESCE(?, priority),
       status = COALESCE(?, status), version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?`,
      patch.targetAmount == null ? null : Math.round(Number(patch.targetAmount) * 100),
      patch.monthlyContributionAmount == null ? null : Math.round(Number(patch.monthlyContributionAmount) * 100),
      patch.priority ?? null,
      patch.status == null ? null : lower(patch.status),
      nowIso(),
      goalId,
      userId,
    );
    if (inputHasPreferences(patch)) this.replacePreferences(goalId, patch.instrumentPreferences);
    return this.list(userId).find((item) => item.id === goalId)!;
  }

  remove(userId: string, goalId: string) {
    return runWrite(this.database, "DELETE FROM user_goals WHERE id = ? AND user_id = ?", goalId, userId).changes > 0;
  }

  private preferences(goalId: string) {
    return runRows<Record<string, unknown>>(
      this.database,
      "SELECT scope FROM investment_preferences WHERE goal_id = ? ORDER BY rank_no",
      goalId,
    ).map((row) => scopeToPreference(row.scope));
  }

  private replacePreferences(goalId: string, preferences: unknown) {
    if (!Array.isArray(preferences)) return;
    const timestamp = nowIso();
    runWrite(this.database, "DELETE FROM investment_preferences WHERE goal_id = ?", goalId);
    preferences.forEach((preference, index) => {
      runWrite(
        this.database,
        `INSERT INTO investment_preferences
         (id, user_id, goal_id, scope, mode, rank_no, created_at, updated_at)
         VALUES (?, (SELECT user_id FROM user_goals WHERE id = ?), ?, ?, 'prefer', ?, ?, ?)`,
        newId("preference"),
        goalId,
        goalId,
        preferenceToScope(preference),
        index + 1,
        timestamp,
        timestamp,
      );
    });
  }
}

function upper(value: unknown) {
  return value == null ? undefined : String(value).toUpperCase();
}

function lower(value: unknown) {
  return value == null ? null : String(value).toLowerCase();
}

function money(value: unknown) {
  return value == null ? "0.00" : (Number(value) / 100).toFixed(2);
}

function inputHasPreferences(input: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(input, "instrumentPreferences");
}

function preferenceToScope(value: unknown) {
  const mapping: Record<string, string> = {
    STOCK: "stock",
    SECTOR_ETF: "sector",
    BROAD_INDEX_ETF: "index",
    INDEX_FUND: "fund",
    GOLD: "gold",
    CASH: "cash",
  };
  return mapping[String(value).toUpperCase()] ?? "other";
}

function scopeToPreference(value: unknown) {
  const mapping: Record<string, string> = {
    stock: "STOCK",
    sector: "SECTOR_ETF",
    index: "BROAD_INDEX_ETF",
    fund: "INDEX_FUND",
    gold: "GOLD",
    cash: "CASH",
  };
  return mapping[String(value).toLowerCase()] ?? "CASH";
}
