export interface HoldingSnapshot {
  instrumentId: string;
  quantity: string;
  price: string;
  marketValue: string;
  weightBps: number;
}

export interface PortfolioScore {
  healthScore: number;
  riskScore: number;
  scoreVersion: string;
  components: {
    returnScore: number;
    drawdownScore: number;
    volatilityScore: number;
    concentrationScore: number;
    liquidityScore: number;
  };
  missingMetrics: string[];
}

export function calculatePortfolioScore(
  totalMarketValue: number,
  holdingSnapshots: HoldingSnapshot[],
  returnPct?: number,
  maxDrawdownPct?: number,
  annualVolatilityPct?: number,
): PortfolioScore {
  const missingMetrics: string[] = [];
  let concentrationScore = 100;

  if (holdingSnapshots.length > 0 && totalMarketValue > 0) {
    const hhi = holdingSnapshots.reduce((sum, holding) => {
      const weight = holding.weightBps / 10000;
      return sum + weight * weight;
    }, 0);
    const minHHI = 1 / holdingSnapshots.length;
    concentrationScore = Math.max(
      0,
      Math.min(100, Math.round(100 * (1 - (hhi - minHHI) / (1 - minHHI + 0.0001)))),
    );
  }

  const returnScore = returnPct === undefined
    ? (missingMetrics.push("return"), 50)
    : Math.max(0, Math.min(100, Math.round(50 + returnPct)));
  const drawdownScore = maxDrawdownPct === undefined
    ? (missingMetrics.push("drawdown"), 75)
    : Math.max(0, Math.min(100, Math.round(100 + maxDrawdownPct * 2)));
  const volatilityScore = annualVolatilityPct === undefined
    ? (missingMetrics.push("volatility"), 75)
    : Math.max(0, Math.min(100, Math.round(100 - annualVolatilityPct * 2)));
  const liquidityScore = Math.min(100, holdingSnapshots.length * 10);

  const healthScore = Math.round(
    returnScore * 0.25 +
      drawdownScore * 0.25 +
      volatilityScore * 0.2 +
      concentrationScore * 0.2 +
      liquidityScore * 0.1,
  );
  const riskScore = Math.round(
    100 - (drawdownScore * 0.4 + volatilityScore * 0.4 + concentrationScore * 0.2),
  );

  return {
    healthScore: Math.max(0, Math.min(100, healthScore)),
    riskScore: Math.max(0, Math.min(100, riskScore)),
    scoreVersion: "v1.0",
    components: { returnScore, drawdownScore, volatilityScore, concentrationScore, liquidityScore },
    missingMetrics,
  };
}
