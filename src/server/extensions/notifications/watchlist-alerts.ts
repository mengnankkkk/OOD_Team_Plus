import Decimal from "decimal.js";

import { getDatabase, parseJson } from "@/server/http/context";

import { advisorPrompt, formatPercent, insertNotification } from "./notification-writer";

export type WatchlistTarget = {
  id: string;
  instrument_id: string;
  symbol: string;
  name: string;
  market: string;
  asset_type: string;
  reason: string | null;
  planned_horizon: string | null;
  drawdown_threshold_bps: number | null;
};

type MarketPoint = { date: string; close: Decimal; preClose: Decimal | null };

export function createWatchlistNotifications(userId: string, targets: WatchlistTarget[]): number {
  if (targets.length === 0) return 0;
  const db = getDatabase();
  let created = 0;
  for (const target of targets) {
    const points = loadMarketPoints(db, target);
    const latest = points[0];
    if (!latest) continue;
    const previousClose = latest.preClose ?? points[1]?.close ?? null;
    const metadataBase = { instrumentId: target.instrument_id, symbol: target.symbol, name: target.name, dataAsOf: latest.date, watchlistItemId: target.id };
    if (previousClose?.gt(0)) {
      const move = latest.close.div(previousClose).minus(1);
      if (move.abs().gte(0.04)) {
        created += insertNotification(db, {
          userId, severity: move.abs().gte(0.07) ? "important" : "attention",
          title: `${target.name} 当日${move.gte(0) ? "上涨" : "下跌"} ${formatPercent(move.toNumber(), false)}`,
          body: `自选标的出现显著波动，最新收盘价 ${latest.close.toDecimalPlaces(4).toString()}。这是一条观察信号，不代表追涨或抄底建议。`,
          sourceType: "WATCHLIST_MOVE", sourceId: target.id, groupKey: `watchlist:${target.id}:move`,
          dedupeKey: `${userId}:watchlist-move:${target.id}:${move.gte(0) ? "up" : "down"}:${latest.date}`, dataAsOf: latest.date,
          metadata: { ...metadataBase, rule: "DAILY_MOVE", metricValue: move.toNumber(), previousValue: previousClose.toNumber(), currentValue: latest.close.toNumber(), advisorPrompt: advisorPrompt(target.name, target.symbol, "自选标的单日异动", move.toNumber(), latest.date, target.reason) },
        });
      }
    }
    const peak = points.slice(0, 20).reduce((value, point) => Decimal.max(value, point.close), latest.close);
    const drawdown = peak.gt(0) ? latest.close.div(peak).minus(1) : new Decimal(0);
    const threshold = new Decimal(target.drawdown_threshold_bps ?? 1_000).div(10_000).neg();
    if (drawdown.lte(threshold)) {
      created += insertNotification(db, {
        userId, severity: drawdown.lte(threshold.mul(1.5)) ? "important" : "attention", title: `${target.name} 触及自选回撤线`,
        body: `最新收盘价较近 20 个交易日高点回撤 ${formatPercent(drawdown.toNumber(), false)}，你的提醒阈值是 ${formatPercent(threshold.toNumber(), false)}。`,
        sourceType: "WATCHLIST_DRAWDOWN", sourceId: target.id, groupKey: `watchlist:${target.id}:drawdown`,
        dedupeKey: `${userId}:watchlist-drawdown:${target.id}:${latest.date}`, dataAsOf: latest.date,
        metadata: { ...metadataBase, rule: "WATCHLIST_DRAWDOWN", metricValue: drawdown.toNumber(), threshold: threshold.toNumber(), currentValue: latest.close.toNumber(), peakValue: peak.toNumber(), advisorPrompt: advisorPrompt(target.name, target.symbol, "近 20 日回撤", drawdown.toNumber(), latest.date, target.reason) },
      });
    }
  }
  db.close();
  return created;
}

export function canonicalSymbol(target: Pick<WatchlistTarget, "symbol" | "market">): string {
  const symbol = target.symbol.trim().toUpperCase();
  if (symbol.includes(".") || !/^\d{6}$/u.test(symbol)) return symbol;
  const market = target.market.toUpperCase();
  return `${symbol}.${["SH", "SZ", "BJ"].includes(market) ? market : symbol.startsWith("6") ? "SH" : "SZ"}`;
}

function loadMarketPoints(db: ReturnType<typeof getDatabase>, target: WatchlistTarget): MarketPoint[] {
  const symbols = [...new Set([target.symbol.toUpperCase(), canonicalSymbol(target).toUpperCase()])];
  const rows = db.prepare(`SELECT ms.raw_payload_json
    FROM market_snapshots ms JOIN instruments i ON i.id=ms.instrument_id
    WHERE UPPER(i.symbol) IN (${symbols.map(() => "?").join(",")})
    ORDER BY ms.trading_date DESC,ms.created_at DESC LIMIT 30`).all(...symbols) as Array<{ raw_payload_json: string }>;
  const byDate = new Map<string, MarketPoint>();
  for (const row of rows) {
    const payload = parseJson<Record<string, unknown>>(row.raw_payload_json, {});
    const date = String(payload.date ?? payload.trade_date ?? "").replace(/\D/gu, "").slice(0, 8);
    const close = safeDecimal(payload.close);
    if (!date || !close?.gt(0) || byDate.has(date)) continue;
    byDate.set(date, { date, close, preClose: safeDecimal(payload.pre_close) });
  }
  return [...byDate.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function safeDecimal(value: unknown): Decimal | null {
  try {
    const decimal = new Decimal(String(value ?? ""));
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}
