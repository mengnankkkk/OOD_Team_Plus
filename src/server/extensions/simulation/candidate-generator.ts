export interface SimulationCandidate {
  sequenceNo: number;
  label: string;
  description: string;
  trades: Array<{
    instrumentId: string;
    action: "BUY" | "SELL";
    quantity: string;
    price?: string;
  }>;
  analysis: {
    strategy: "HOLD" | "BALANCED" | "DEFENSIVE" | "GROWTH";
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    forecast: { expectedReturn: number; bullCaseReturn: number; bearCaseReturn: number; annualVolatility: number; maxDrawdown: number; concentrationHHI: number };
    rationale: string[];
    counterEvidence: string[];
    risks: string[];
    assumptions: string[];
  };
}

import { createHash } from "node:crypto";

import { getDatabase } from "@/server/http/context";

export interface PriceManifest {
  prices: Record<string, string>;
  sha256: string;
  capturedAt: string;
}

export async function generateCandidates(
  objective: string,
  portfolioSnapshotId: string,
  activeBranchId?: string,
): Promise<{ candidates: SimulationCandidate[]; priceManifest: PriceManifest }> {
  const db = getDatabase();
  const rows = (activeBranchId
    ? db.prepare(`SELECT h.instrument_id, h.quantity_decimal, h.price_decimal, h.market_value_decimal,
        i.symbol, i.name, i.asset_type, i.sector
      FROM simulation_asset_snapshot_items h
      JOIN simulation_asset_snapshots s ON s.id=h.snapshot_id
      LEFT JOIN instruments i ON i.id=h.instrument_id
      WHERE s.branch_id=? ORDER BY CAST(h.market_value_decimal AS REAL) DESC`).all(activeBranchId)
    : db.prepare(`SELECT h.instrument_id, h.quantity_decimal, h.price_decimal, h.market_value_decimal,
        i.symbol, i.name, i.asset_type, i.sector
      FROM holding_snapshots h LEFT JOIN instruments i ON i.id = h.instrument_id
      WHERE h.portfolio_snapshot_id = ? ORDER BY CAST(h.market_value_decimal AS REAL) DESC`).all(portfolioSnapshotId)) as Array<Record<string, unknown>>;
  const instruments = db.prepare("SELECT id, symbol, name, asset_type, sector FROM instruments WHERE tradable = 1 ORDER BY symbol").all() as Array<Record<string, unknown>>;
  db.close();

  const prices: Record<string, string> = {};
  for (const row of rows) {
    const quantity = Number(row.quantity_decimal);
    const marketValue = Number(row.market_value_decimal);
    prices[String(row.instrument_id)] = (Number(row.price_decimal) || (quantity ? marketValue / quantity : 0)).toFixed(8);
  }
  const objectiveText = objective.toLowerCase();
  const defensive = /风险|回撤|保守|稳健|防守|risk|drawdown|defensive/u.test(objectiveText);
  const growth = /增长|收益|进取|成长|growth|return|aggressive/u.test(objectiveText);
  const target = defensive
    ? instruments.find((instrument) => String(instrument.symbol).toUpperCase() === "GLD") ?? instruments.find((instrument) => instrument.sector === "Broad Market")
    : instruments.find((instrument) => instrument.sector === "Broad Market" && !rows.some((row) => row.instrument_id === instrument.id))
      ?? instruments.find((instrument) => instrument.sector === "Broad Market")
      ?? instruments.find((instrument) => instrument.asset_type === "fund");
  if (target && !prices[String(target.id)]) {
    const source = rows.find((row) => row.asset_type === "fund") ?? rows[0];
    prices[String(target.id)] = Number(source?.price_decimal ?? 100).toFixed(8);
  }

  const largest = rows[0];
  const largestQuantity = Number(largest?.quantity_decimal ?? 0);
  const largestPrice = Number(prices[String(largest?.instrument_id)] ?? 0);
  const sellQuantity = largestQuantity > 0 ? trimQuantity(largestQuantity * 0.2) : "0";
  const buyQuantity = target && largestPrice > 0 ? trimQuantity((largestQuantity * largestPrice * 0.18) / Number(prices[String(target.id)])) : "0";
  const optionBTrades = largest && sellQuantity !== "0" && target && buyQuantity !== "0"
    ? [{ instrumentId: String(largest.instrument_id), action: "SELL" as const, quantity: sellQuantity, price: prices[String(largest.instrument_id)] }, { instrumentId: String(target.id), action: "BUY" as const, quantity: buyQuantity, price: prices[String(target.id)] }]
    : [];
  const aggressiveSellRatio = defensive ? 0.45 : growth ? 0.3 : 0.35;
  const optionCTrades = largest && sellQuantity !== "0" && target && buyQuantity !== "0"
    ? [{ instrumentId: String(largest.instrument_id), action: "SELL" as const, quantity: trimQuantity(largestQuantity * aggressiveSellRatio), price: prices[String(largest.instrument_id)] }, { instrumentId: String(target.id), action: "BUY" as const, quantity: trimQuantity((largestQuantity * largestPrice * (aggressiveSellRatio - 0.03)) / Number(prices[String(target.id)])), price: prices[String(target.id)] }]
    : [];
  const capturedAt = new Date().toISOString();
  const canonical = JSON.stringify({ capturedAt, prices });

  const candidates = [
    candidate(0, "A · 保持观察", `保持当前组合不变，继续观察“${objective}”`, [], "HOLD", rows, prices, objective),
    candidate(1, "B · 均衡再平衡", "降低最大单一持仓约 20%，转入宽基或低相关资产", optionBTrades, "BALANCED", rows, prices, objective),
    candidate(2, defensive ? "C · 防守降波" : growth ? "C · 进取轮动" : "C · 深度分散",
      defensive ? "降低最大持仓约 45%，提高防守资产比例" : growth ? "降低集中度并保留进攻敞口" : "进一步降低集中度，扩大分散配置",
      optionCTrades, defensive ? "DEFENSIVE" : growth ? "GROWTH" : "BALANCED", rows, prices, objective),
  ];

  return {
    candidates,
    priceManifest: {
      prices,
      sha256: createHash("sha256").update(canonical).digest("hex"),
      capturedAt,
    },
  };
}

function candidate(
  sequenceNo: number,
  label: string,
  description: string,
  trades: SimulationCandidate["trades"],
  strategy: SimulationCandidate["analysis"]["strategy"],
  rows: Array<Record<string, unknown>>,
  prices: Record<string, string>,
  objective: string,
): SimulationCandidate {
  const weights = projectedWeights(rows, trades, prices);
  const hhi = weights.reduce((sum, item) => sum + item.weight ** 2, 0);
  const riskFactor = strategy === "DEFENSIVE" ? 0.72 : strategy === "GROWTH" ? 1.18 : strategy === "HOLD" ? 1 : 0.86;
  const annualVolatility = clamp((0.09 + hhi * 0.22) * riskFactor, 0.04, 0.45);
  const expectedReturn = clamp((0.055 + (strategy === "GROWTH" ? 0.028 : strategy === "DEFENSIVE" ? -0.012 : 0.006)) - hhi * 0.015, -0.08, 0.2);
  const maxDrawdown = -clamp(annualVolatility * (strategy === "DEFENSIVE" ? 1.15 : 1.45), 0.05, 0.6);
  const riskLevel = annualVolatility < 0.13 ? "LOW" : annualVolatility < 0.22 ? "MEDIUM" : "HIGH";
  return {
    sequenceNo, label, description, trades,
    analysis: {
      strategy, riskLevel,
      forecast: {
        expectedReturn: round4(expectedReturn), bullCaseReturn: round4(expectedReturn + annualVolatility * 0.85),
        bearCaseReturn: round4(expectedReturn - annualVolatility * 1.25), annualVolatility: round4(annualVolatility),
        maxDrawdown: round4(maxDrawdown), concentrationHHI: round4(hhi),
      },
      rationale: [
        trades.length ? `将最大持仓风险敞口重新分配，模拟后 HHI 为 ${hhi.toFixed(3)}` : "不产生交易成本，保留当前资产结构",
        `围绕目标“${objective}”使用同一价格清单比较所有方案`,
        `风险级别由集中度、资产类型与情景波动联合估算为 ${riskLevel}`,
      ],
      counterEvidence: [trades.length ? "再平衡可能在原持仓继续上涨时损失部分收益" : "保持不动会延续当前集中度和回撤暴露"],
      risks: ["价格清单固定，未计入盘中滑点", "收益区间是情景估计，不是收益承诺", "资产间相关性采用简化假设"],
      assumptions: ["预测周期：12 个月", "交易费率：0.10%", "不使用杠杆与卖空", "成交价使用同一批次冻结价格"],
    },
  };
}

function projectedWeights(rows: Array<Record<string, unknown>>, trades: SimulationCandidate["trades"], prices: Record<string, string>) {
  const quantities = new Map(rows.map((row) => [String(row.instrument_id), Number(row.quantity_decimal)]));
  for (const trade of trades) {
    const current = quantities.get(trade.instrumentId) ?? 0;
    quantities.set(trade.instrumentId, Math.max(0, current + (trade.action === "BUY" ? 1 : -1) * Number(trade.quantity)));
  }
  const values = [...quantities.entries()].map(([instrumentId, quantity]) => ({ instrumentId, value: quantity * Number(prices[instrumentId] ?? 0) })).filter((item) => item.value > 0);
  const total = values.reduce((sum, item) => sum + item.value, 0);
  return values.map((item) => ({ ...item, weight: total > 0 ? item.value / total : 0 }));
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function round4(value: number) { return Math.round(value * 10_000) / 10_000; }

function trimQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(8).replace(/0+$/u, "").replace(/\.$/u, "");
}
