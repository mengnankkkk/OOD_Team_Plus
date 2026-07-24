import { sb } from "@/services/supabaseClient";
import type { UserGoal } from "@/types/app/user";

const mapRow = (row: any): UserGoal => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  category: row.category ?? "custom",
  targetAmount: Number(row.target_amount ?? 0),
  currentAmount: Number(row.current_amount ?? 0),
  targetDate: row.target_date,
  priority: row.priority ?? 1,
  monthlyContribution: row.monthly_contribution !== null ? Number(row.monthly_contribution) : null,
  successProbability: row.success_probability !== null ? Number(row.success_probability) : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listGoals(userId: string): Promise<UserGoal[]> {
  const { data, error } = await sb
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .order("priority", { ascending: true })
    .range(0, 49);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function createGoal(userId: string, input: Omit<UserGoal, "id" | "userId" | "createdAt" | "updatedAt">): Promise<UserGoal> {
  const { data, error } = await sb
    .from("goals")
    .insert({
      user_id: userId,
      name: input.name,
      category: input.category,
      target_amount: input.targetAmount,
      current_amount: input.currentAmount,
      target_date: input.targetDate,
      priority: input.priority,
      monthly_contribution: input.monthlyContribution,
      success_probability: input.successProbability,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateGoal(userId: string, goalId: string, patch: Partial<Omit<UserGoal, "id" | "userId" | "createdAt" | "updatedAt">>): Promise<UserGoal> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.category !== undefined) payload.category = patch.category;
  if (patch.targetAmount !== undefined) payload.target_amount = patch.targetAmount;
  if (patch.currentAmount !== undefined) payload.current_amount = patch.currentAmount;
  if (patch.targetDate !== undefined) payload.target_date = patch.targetDate;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.monthlyContribution !== undefined) payload.monthly_contribution = patch.monthlyContribution;
  if (patch.successProbability !== undefined) payload.success_probability = patch.successProbability;
  const { data, error } = await sb
    .from("goals")
    .update(payload)
    .eq("user_id", userId)
    .eq("id", goalId)
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteGoal(userId: string, goalId: string): Promise<void> {
  const { error } = await sb.from("goals").delete().eq("user_id", userId).eq("id", goalId);
  if (error) throw error;
}
