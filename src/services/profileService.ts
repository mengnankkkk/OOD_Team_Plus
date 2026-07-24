import { apiGet, apiPatch } from "@/features/frontend-migration/api";
import type { UserProfile, UserProfileUpdate } from "@/types/app/user";

type ApiProfile = {
  id?: string;
  riskLevel?: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | null;
  preferences?: Record<string, unknown>;
  status?: string;
  version?: number;
  updatedAt?: string;
};

const riskFromApi = (risk: ApiProfile["riskLevel"]): UserProfile["riskLevel"] =>
  risk === "CONSERVATIVE" ? "R2" : risk === "AGGRESSIVE" ? "R4" : "R3";
const riskToApi = (risk: UserProfile["riskLevel"]): NonNullable<ApiProfile["riskLevel"]> =>
  risk === "R1" || risk === "R2" ? "CONSERVATIVE" : risk === "R4" || risk === "R5" ? "AGGRESSIVE" : "BALANCED";

function mapProfile(row: ApiProfile): UserProfile {
  const prefs = row.preferences ?? {};
  const now = row.updatedAt ?? new Date(0).toISOString();
  return {
    id: row.id ?? "profile",
    displayName: String(prefs.displayName ?? ""),
    age: prefs.age == null ? null : Number(prefs.age),
    household: prefs.household == null ? null : String(prefs.household),
    monthlyIncome: prefs.monthlyIncome == null ? null : Number(prefs.monthlyIncome),
    monthlyExpense: prefs.monthlyExpense == null ? null : Number(prefs.monthlyExpense),
    liabilities: prefs.liabilities == null ? null : Number(prefs.liabilities),
    emergencyTargetMonths: Number(prefs.emergencyTargetMonths ?? 6),
    riskLevel: riskFromApi(row.riskLevel),
    riskSubjective: prefs.riskSubjective == null ? null : String(prefs.riskSubjective),
    riskCapacity: prefs.riskCapacity == null ? null : String(prefs.riskCapacity),
    behaviorNotes: prefs.behaviorNotes == null ? null : String(prefs.behaviorNotes),
    onboardingCompleted: row.status === "COMPLETED" || Boolean(prefs.onboardingCompleted),
    createdAt: String(prefs.createdAt ?? now),
    updatedAt: now,
  };
}

export async function fetchCurrentProfile(_userId: string): Promise<UserProfile> {
  return mapProfile(await apiGet<ApiProfile>("/api/v1/profile"));
}

export async function ensureProfile(userId: string, _fallbackName: string): Promise<UserProfile> {
  return fetchCurrentProfile(userId);
}

export async function updateProfile(_userId: string, changes: UserProfileUpdate): Promise<UserProfile> {
  const current = await apiGet<ApiProfile>("/api/v1/profile");
  const preferences: Record<string, unknown> = { ...current.preferences };
  for (const [key, value] of Object.entries(changes)) if (key !== "riskLevel") preferences[key] = value;
  const updated = await apiPatch<ApiProfile>("/api/v1/profile", {
    riskLevel: changes.riskLevel ? riskToApi(changes.riskLevel) : current.riskLevel,
    preferences,
  }, current.version);
  return mapProfile(updated);
}
