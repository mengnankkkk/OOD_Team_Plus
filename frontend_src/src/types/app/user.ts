export type RiskLevel = "R1" | "R2" | "R3" | "R4" | "R5";

export interface UserProfile {
  id: string;
  displayName: string;
  age: number | null;
  household: string | null;
  monthlyIncome: number | null;
  monthlyExpense: number | null;
  liabilities: number | null;
  emergencyTargetMonths: number;
  riskLevel: RiskLevel;
  riskSubjective: string | null;
  riskCapacity: string | null;
  behaviorNotes: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileUpdate {
  displayName?: string;
  age?: number | null;
  household?: string | null;
  monthlyIncome?: number | null;
  monthlyExpense?: number | null;
  liabilities?: number | null;
  emergencyTargetMonths?: number;
  riskLevel?: RiskLevel;
  riskSubjective?: string | null;
  riskCapacity?: string | null;
  behaviorNotes?: string | null;
  onboardingCompleted?: boolean;
}

export interface UserGoal {
  id: string;
  userId: string;
  name: string;
  category: "house" | "emergency" | "education" | "retirement" | "custom";
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  priority: number;
  monthlyContribution: number | null;
  successProbability: number | null;
  createdAt: string;
  updatedAt: string;
}
