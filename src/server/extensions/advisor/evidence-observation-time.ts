import type { ProfessionalAgentRole } from "./professional-contracts";

export function observedAtForFinding(input: {
  agent: ProfessionalAgentRole;
  stance: "support" | "counter" | "missing";
  generatedAt: string;
  marketDataAsOf: string | null;
  portfolioSnapshotAsOf: string | null;
  profileAsOf: string | null;
}): string {
  if (input.stance === "missing") return input.generatedAt;
  if (input.agent === "DATA_RESEARCH") return input.marketDataAsOf ?? input.generatedAt;
  if (input.agent === "PORTFOLIO_RISK") return input.portfolioSnapshotAsOf ?? input.generatedAt;
  if (input.agent === "PROFILE_CONTEXT") return input.profileAsOf ?? input.generatedAt;
  return input.generatedAt;
}
