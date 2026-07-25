import { apiGet, apiPatch } from "@/features/frontend-migration/api";
import type { UserProfile, UserProfileUpdate } from "@/types/app/user";

type ApiProfile = {
  id?: string;
  riskLevel?: "R1" | "R2" | "R3" | "R4" | "R5" | "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | null;
  preferences?: Record<string, unknown>;
  status?: string;
  version?: number;
  updatedAt?: string;
  hasGoal?: boolean;
  onboardingCompleted?: boolean;
};

const riskFromApi = (risk: ApiProfile["riskLevel"]): UserProfile["riskLevel"] => {
  if (risk === null || risk === undefined) return null;
  if (risk === "R1" || risk === "R2" || risk === "R3" || risk === "R4" || risk === "R5") return risk as UserProfile["riskLevel"];
  return risk === "CONSERVATIVE" ? "R2" : risk === "AGGRESSIVE" ? "R4" : "R3";
};
const riskToApi = (risk: UserProfile["riskLevel"]): NonNullable<ApiProfile["riskLevel"]> =>
  risk ?? "R3";

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
    hasGoal: Boolean(row.hasGoal),
    onboardingCompleted: row.onboardingCompleted === undefined
      ? ((row.status === "COMPLETED" || row.status === "COMPLETE") && Boolean(row.hasGoal))
      : Boolean(row.onboardingCompleted),
    createdAt: String(prefs.createdAt ?? now),
    updatedAt: now,
  };
}

export async function fetchCurrentProfile(_userId: string): Promise<UserProfile> {
  void _userId;
  return mapProfile(await apiGet<ApiProfile>("/api/v1/profile"));
}

export async function ensureProfile(userId: string, _fallbackName: string): Promise<UserProfile> {
  void _fallbackName;
  return fetchCurrentProfile(userId);
}

export async function updateProfile(_userId: string, changes: UserProfileUpdate): Promise<UserProfile> {
  void _userId;
  const current = await apiGet<ApiProfile>("/api/v1/profile");
  const preferences: Record<string, unknown> = { ...current.preferences };
  for (const [key, value] of Object.entries(changes)) if (key !== "riskLevel") preferences[key] = value;
  const nextRiskLevel = changes.riskLevel === undefined ? riskFromApi(current.riskLevel) : changes.riskLevel;
  const apiRiskLevel = nextRiskLevel ? riskToApi(nextRiskLevel) : null;
  const updated = await apiPatch<ApiProfile>("/api/v1/profile", {
    riskLevel: apiRiskLevel,
    preferences,
  }, current.version);
  return mapProfile(updated);
}
