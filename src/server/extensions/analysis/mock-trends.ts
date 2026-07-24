// Deterministic mock trend generator. Mock data must not drive alerts or evidence.
export interface TrendPoint {
  date: string;
  value: number;
}

export interface PortfolioTrend {
  metric: string;
  points: TrendPoint[];
  source: "MOCK";
  modelVersion: "mock-trend-v1";
}

export function generateMockTrends(
  portfolioSnapshotId: string,
  metric: "total_return" | "drawdown" | "volatility" | "concentration",
  days = 30,
): PortfolioTrend {
  const seed = portfolioSnapshotId.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const points: TrendPoint[] = [];
  const today = new Date();
  let value = seed % 20;
  let lcg = seed;

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - index);

    lcg = (1664525 * lcg + 1013904223) | 0;
    const delta = (((lcg >>> 16) & 0xff) / 255) * 4 - 2;
    value = Math.max(-50, Math.min(50, value + delta));

    points.push({
      date: date.toISOString().split("T")[0],
      value: Math.round(value * 100) / 100,
    });
  }

  return { metric, points, source: "MOCK", modelVersion: "mock-trend-v1" };
}
