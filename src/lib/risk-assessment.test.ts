import { describe, expect, it } from "vitest";

import { evaluateRiskAssessment, RISK_QUESTIONS } from "./risk-assessment";

describe("risk assessment", () => {
  it("requires every questionnaire answer", () => {
    const result = evaluateRiskAssessment({});
    expect(result.missingQuestionIds).toHaveLength(RISK_QUESTIONS.length);
  });

  it("caps a high willingness score when financial capacity is low", () => {
    const answers = {
      financial_stability: "unstable",
      emergency_reserve: "under3",
      debt_burden: "overburdened",
      investment_experience: "advanced",
      investment_knowledge: "high",
      holding_horizon: "over5",
      loss_reaction: "add",
      max_drawdown: "over30",
      near_term_use: "not_needed",
    };
    const result = evaluateRiskAssessment(answers);
    expect(result.capacityLevel).toBe("R3");
    expect(result.willingnessLevel).toBe("R5");
    expect(result.riskLevel).toBe("R3");
    expect(result.conflicts).toHaveLength(1);
  });

  it("classifies consistently for a low-volatility beginner profile", () => {
    const result = evaluateRiskAssessment({
      financial_stability: "stable",
      emergency_reserve: "6to12",
      debt_burden: "manageable",
      investment_experience: "none",
      investment_knowledge: "none",
      holding_horizon: "under1",
      loss_reaction: "sell",
      max_drawdown: "under10",
      near_term_use: "needed",
    });
    expect(["R1", "R2"]).toContain(result.riskLevel);
    expect(result.recommendedMaxEquityWeight).toBeLessThanOrEqual(0.4);
  });
});
