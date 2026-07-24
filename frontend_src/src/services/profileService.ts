import { sb } from "@/services/supabaseClient";
import type { UserProfile, UserProfileUpdate } from "@/types/app/user";

const mapRow = (row: any): UserProfile => ({
  id: row.id,
  displayName: row.display_name ?? "",
  age: row.age,
  household: row.household,
  monthlyIncome: row.monthly_income !== null ? Number(row.monthly_income) : null,
  monthlyExpense: row.monthly_expense !== null ? Number(row.monthly_expense) : null,
  liabilities: row.liabilities !== null ? Number(row.liabilities) : null,
  emergencyTargetMonths: row.emergency_target_months ?? 6,
  riskLevel: row.risk_level ?? "R3",
  riskSubjective: row.risk_subjective,
  riskCapacity: row.risk_capacity,
  behaviorNotes: row.behavior_notes,
  onboardingCompleted: row.onboarding_completed ?? false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function fetchCurrentProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRow(data);
}

export async function ensureProfile(userId: string, fallbackName: string): Promise<UserProfile> {
  const existing = await fetchCurrentProfile(userId);
  if (existing) return existing;
  const { data, error } = await sb
    .from("profiles")
    .insert({ id: userId, display_name: fallbackName })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateProfile(userId: string, changes: UserProfileUpdate): Promise<UserProfile> {
  const payload: Record<string, unknown> = {};
  if (changes.displayName !== undefined) payload.display_name = changes.displayName;
  if (changes.age !== undefined) payload.age = changes.age;
  if (changes.household !== undefined) payload.household = changes.household;
  if (changes.monthlyIncome !== undefined) payload.monthly_income = changes.monthlyIncome;
  if (changes.monthlyExpense !== undefined) payload.monthly_expense = changes.monthlyExpense;
  if (changes.liabilities !== undefined) payload.liabilities = changes.liabilities;
  if (changes.emergencyTargetMonths !== undefined) payload.emergency_target_months = changes.emergencyTargetMonths;
  if (changes.riskLevel !== undefined) payload.risk_level = changes.riskLevel;
  if (changes.riskSubjective !== undefined) payload.risk_subjective = changes.riskSubjective;
  if (changes.riskCapacity !== undefined) payload.risk_capacity = changes.riskCapacity;
  if (changes.behaviorNotes !== undefined) payload.behavior_notes = changes.behaviorNotes;
  if (changes.onboardingCompleted !== undefined) payload.onboarding_completed = changes.onboardingCompleted;

  const { data, error } = await sb
    .from("profiles")
    .update(payload)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data);
}
