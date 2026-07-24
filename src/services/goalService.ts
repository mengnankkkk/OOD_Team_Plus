import { apiDelete, apiGet, apiPatch, apiPost } from "@/features/frontend-migration/api";
import type { UserGoal } from "@/types/app/user";

type GoalRow = Record<string, unknown>;

const mapRow = (row: GoalRow, userId: string): UserGoal => ({
  id: String(row.id),
  userId,
  name: String(row.name),
  category: String(row.category ?? "custom") as UserGoal["category"],
  targetAmount: Number(row.targetAmount ?? row.target_amount_decimal ?? 0),
  currentAmount: Number(row.currentAmount ?? 0),
  targetDate: row.targetDate == null && row.target_date == null ? null : String(row.targetDate ?? row.target_date),
  priority: Number(row.priority ?? 1),
  monthlyContribution: row.monthlyContribution == null ? null : Number(row.monthlyContribution),
  successProbability: row.successProbability == null ? null : Number(row.successProbability),
  createdAt: String(row.createdAt ?? row.created_at ?? new Date(0).toISOString()),
  updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date(0).toISOString()),
  ...({ version: Number(row.version ?? 1) } as object),
});

export async function listGoals(userId: string): Promise<UserGoal[]> {
  const result = await apiGet<{ items: GoalRow[] }>("/api/v1/goals");
  return result.items.map((row) => mapRow(row, userId));
}

export async function createGoal(userId: string, input: Omit<UserGoal, "id" | "userId" | "createdAt" | "updatedAt">): Promise<UserGoal> {
  const row = await apiPost<GoalRow>("/api/v1/goals", {
    name: input.name,
    targetAmount: String(input.targetAmount),
    targetDate: input.targetDate,
    horizon: "LONG",
    priority: String(input.priority),
    assetPreference: input.category,
  });
  return mapRow(row, userId);
}

export async function updateGoal(userId: string, goalId: string, changes: Partial<Omit<UserGoal, "id" | "userId" | "createdAt" | "updatedAt">>): Promise<UserGoal> {
  const current = (await listGoals(userId)).find((goal) => goal.id === goalId);
  if (!current) throw new Error("目标不存在");
  const row = await apiPatch<GoalRow>(`/api/v1/goals/${goalId}`, {
    name: changes.name,
    targetAmount: changes.targetAmount === undefined ? undefined : String(changes.targetAmount),
    targetDate: changes.targetDate,
    priority: changes.priority === undefined ? undefined : String(changes.priority),
    assetPreference: changes.category,
  }, Number((current as UserGoal & { version?: number }).version ?? 1));
  return mapRow(row, userId);
}

export async function deleteGoal(_userId: string, goalId: string): Promise<void> {
  await apiDelete(`/api/v1/goals/${goalId}`);
}
