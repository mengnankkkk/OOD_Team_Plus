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
  totalMarketValue: string | number,
  holdingSnapshots: HoldingSnapshot[],
  returnPct?: number,
  maxDrawdownPct?: number,
  annualVolatilityPct?: number,
  liquidityScoreInput?: number,
): PortfolioScore {
  const missingMetrics: string[] = [];
  const total = decimal(totalMarketValue);
  let concentrationScore = new Decimal(100);

  if (holdingSnapshots.length === 1 && total.gt(0)) {
    concentrationScore = new Decimal(0);
  } else if (holdingSnapshots.length > 1 && total.gt(0)) {
    const hhi = holdingSnapshots.reduce((sum, holding) => {
      const weight = new Decimal(holding.weightBps).div(10_000);
      return sum.plus(weight.pow(2));
    }, new Decimal(0));
    const minHHI = new Decimal(1).div(holdingSnapshots.length);
    concentrationScore = clamp(new Decimal(100).mul(new Decimal(1).minus(hhi.minus(minHHI).div(new Decimal(1).minus(minHHI).plus("0.0001")))));
  }

  const returnScore = returnPct === undefined
    ? (missingMetrics.push("return"), new Decimal(50))
    : clamp(new Decimal(50).plus(returnPct));
  const drawdownScore = maxDrawdownPct === undefined
    ? (missingMetrics.push("drawdown"), new Decimal(75))
    : clamp(new Decimal(100).plus(new Decimal(maxDrawdownPct).mul(2)));
  const volatilityScore = annualVolatilityPct === undefined
    ? (missingMetrics.push("volatility"), new Decimal(75))
    : clamp(new Decimal(100).minus(new Decimal(annualVolatilityPct).mul(2)));
  const liquidityScore = liquidityScoreInput === undefined
    ? Decimal.min(100, new Decimal(holdingSnapshots.length).mul(10))
    : clamp(new Decimal(liquidityScoreInput));

  const healthScore = returnScore.mul("0.25")
    .plus(drawdownScore.mul("0.25"))
    .plus(volatilityScore.mul("0.2"))
    .plus(concentrationScore.mul("0.2"))
    .plus(liquidityScore.mul("0.1"));
  const riskScore = new Decimal(100).minus(
    drawdownScore.mul("0.4").plus(volatilityScore.mul("0.4")).plus(concentrationScore.mul("0.2")),
  );

  return {
    healthScore: scoreNumber(healthScore),
    riskScore: scoreNumber(riskScore),
    scoreVersion: "v1.0",
    components: {
      returnScore: scoreNumber(returnScore),
      drawdownScore: scoreNumber(drawdownScore),
      volatilityScore: scoreNumber(volatilityScore),
      concentrationScore: scoreNumber(concentrationScore),
      liquidityScore: scoreNumber(liquidityScore),
    },
    missingMetrics,
  };
}

function decimal(value: string | number): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error("INVALID_FINANCIAL_DECIMAL");
  return result;
}

function clamp(value: Decimal): Decimal {
  return Decimal.max(0, Decimal.min(100, value));
}

function scoreNumber(value: Decimal): number {
  return clamp(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}
import Decimal from "decimal.js";
