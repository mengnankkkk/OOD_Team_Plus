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
): Promise<{ candidates: SimulationCandidate[]; priceManifest: PriceManifest }> {
  const db = getDatabase();
  const rows = db.prepare(`SELECT h.instrument_id, h.quantity_decimal, h.price_decimal, h.market_value_decimal,
      i.symbol, i.name, i.asset_type, i.sector
    FROM holding_snapshots h LEFT JOIN instruments i ON i.id = h.instrument_id
    WHERE h.portfolio_snapshot_id = ? ORDER BY CAST(h.market_value_decimal AS REAL) DESC`).all(portfolioSnapshotId) as Array<Record<string, unknown>>;
  const instruments = db.prepare("SELECT id, symbol, name, asset_type, sector FROM instruments WHERE tradable = 1 ORDER BY symbol").all() as Array<Record<string, unknown>>;
  db.close();

  const prices: Record<string, string> = {};
  for (const row of rows) {
    const quantity = Number(row.quantity_decimal);
    const marketValue = Number(row.market_value_decimal);
    prices[String(row.instrument_id)] = (Number(row.price_decimal) || (quantity ? marketValue / quantity : 0)).toFixed(8);
  }
  const target = instruments.find((instrument) => !rows.some((row) => row.instrument_id === instrument.id) && instrument.asset_type === "fund")
    ?? instruments.find((instrument) => instrument.asset_type === "fund");
  if (target && !prices[String(target.id)]) {
    const source = rows.find((row) => row.asset_type === "fund") ?? rows[0];
    prices[String(target.id)] = Number(source?.price_decimal ?? 100).toFixed(8);
  }

  const largest = rows[0];
  const largestQuantity = Number(largest?.quantity_decimal ?? 0);
  const largestPrice = Number(prices[String(largest?.instrument_id)] ?? 0);
  const sellQuantity = largestQuantity > 0 ? trimQuantity(largestQuantity * 0.25) : "0";
  const buyQuantity = target && largestPrice > 0 ? trimQuantity((largestQuantity * largestPrice * 0.2) / Number(prices[String(target.id)])) : "0";
  const optionBTrades = largest && sellQuantity !== "0" && target && buyQuantity !== "0"
    ? [{ instrumentId: String(largest.instrument_id), action: "SELL" as const, quantity: sellQuantity, price: prices[String(largest.instrument_id)] }, { instrumentId: String(target.id), action: "BUY" as const, quantity: buyQuantity, price: prices[String(target.id)] }]
    : [];
  const optionCTrades = largest && sellQuantity !== "0" && target && buyQuantity !== "0"
    ? [{ instrumentId: String(largest.instrument_id), action: "SELL" as const, quantity: trimQuantity(largestQuantity * 0.5), price: prices[String(largest.instrument_id)] }, { instrumentId: String(target.id), action: "BUY" as const, quantity: trimQuantity((largestQuantity * largestPrice * 0.45) / Number(prices[String(target.id)])), price: prices[String(target.id)] }]
    : [];
  const capturedAt = new Date().toISOString();
  const canonical = JSON.stringify({ capturedAt, prices });

  return {
    candidates: [
      { sequenceNo: 0, label: "Option A", description: `保持当前组合不变（${objective}）`, trades: [] },
      { sequenceNo: 1, label: "Option B", description: "卖出最大持仓约 25%，转入分散资产", trades: optionBTrades },
      { sequenceNo: 2, label: "Option C", description: "卖出最大持仓约 50%，进行更积极的分散配置", trades: optionCTrades },
    ],
    priceManifest: {
      prices,
      sha256: createHash("sha256").update(canonical).digest("hex"),
      capturedAt,
    },
  };
}

function trimQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(8).replace(/0+$/u, "").replace(/\.$/u, "");
}
