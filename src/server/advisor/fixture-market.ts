type FixtureProfile = {
  price?: number;
  trend?: number;
  volatility?: number;
  peTtm?: number;
  pePercentile?: number;
  industryPeMedian?: number;
  macdState: string;
  zeroAxis: string;
  weeklyAlignment: string;
  volumeConfirmation: string;
  revenueYoY?: number;
  netProfitYoY?: number;
  roe?: number;
  event?: string;
};

import { currentDateIso } from "@/server/advisor/date-utils";

const fixtureProfiles: Record<string, FixtureProfile> = {
  "000001.SZ": {
    price: 10.42,
    trend: -0.004,
    volatility: 0.022,
    peTtm: 5.8,
    pePercentile: 0.22,
    industryPeMedian: 6.4,
    macdState: "BEARISH",
    zeroAxis: "BELOW",
    weeklyAlignment: "NEUTRAL",
    volumeConfirmation: "NORMAL",
    revenueYoY: 0.1,
    netProfitYoY: 0.03,
    roe: 0.098,
    event: "银行板块净息差与资产质量仍需跟踪",
  },
  "510300.SH": {
    price: 4.35,
    trend: 0.002,
    volatility: 0.015,
    peTtm: 12.4,
    pePercentile: 0.29,
    industryPeMedian: 13.2,
    macdState: "NEUTRAL",
    zeroAxis: "ABOVE",
    weeklyAlignment: "NEUTRAL",
    volumeConfirmation: "NORMAL",
    revenueYoY: 0.07,
    netProfitYoY: 0.05,
    roe: 0.11,
  },
  "000300.SH": {
    price: 4000,
    trend: 0.001,
    volatility: 0.015,
    peTtm: 12.4,
    pePercentile: 0.29,
    industryPeMedian: 13.2,
    macdState: "NEUTRAL",
    zeroAxis: "ABOVE",
    weeklyAlignment: "NEUTRAL",
    volumeConfirmation: "NORMAL",
    revenueYoY: 0.07,
    netProfitYoY: 0.05,
    roe: 0.11,
  },
  "518880.SH": {
    price: 5.08,
    trend: 0.009,
    volatility: 0.018,
    macdState: "OVERBOUGHT",
    zeroAxis: "ABOVE",
    weeklyAlignment: "BULLISH",
    volumeConfirmation: "NORMAL",
    event: "金价短期涨幅较快，追高风险上升",
  },
};

const emptyProfile: FixtureProfile = {
  macdState: "UNKNOWN",
  zeroAxis: "UNKNOWN",
  weeklyAlignment: "UNKNOWN",
  volumeConfirmation: "UNKNOWN",
};

export function fixtureMarketSeries(symbol: string, days = 160) {
  const profile = fixtureProfiles[symbol];
  if (!profile || profile.price == null || profile.trend == null || profile.volatility == null) return [];
  const today = new Date(`${currentDateIso()}T00:00:00Z`);
  const rows: Array<Record<string, unknown>> = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - index);
    const cycle = Math.sin((days - index) / 9) * profile.volatility;
    const drift = (days - index - days / 2) * profile.trend * 0.01;
    const close = Math.max(0.01, profile.price * (1 + cycle + drift));
    rows.push({
      symbol,
      date: date.toISOString().slice(0, 10).replace(/-/g, ""),
      open: Number((close * 0.995).toFixed(4)),
      high: Number((close * 1.018).toFixed(4)),
      low: Number((close * 0.982).toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: Math.round(1_000_000 + Math.abs(cycle) * 50_000_000),
    });
  }
  rows[rows.length - 1].close = profile.price;
  return rows;
}

export function fixtureResearchMetrics(symbol: string) {
  return fixtureProfiles[symbol] ?? emptyProfile;
}
