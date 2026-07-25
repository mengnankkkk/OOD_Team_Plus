import Decimal from "decimal.js";

import { getPortfolioHoldings, getPortfolioMetrics } from "@/server/extensions/analysis/service";
import { getDatabase } from "@/server/http/context";

import { advisorPrompt, formatPercent, insertNotification } from "./notification-writer";

const STALE_DATA_MS = 72 * 60 * 60 * 1_000;

export function createPortfolioNotifications(userId: string): number {
  const view = getPortfolioHoldings(userId);
  if (!view) return 0;
  const metrics = getPortfolioMetrics(userId);
  const db = getDatabase();
  const previousPrices = previousSnapshotPrices(db, userId, view.portfolioSnapshotId);
  const dataAsOf = String(view.asOf);
  const dataBucket = dateBucket(dataAsOf);
  let created = 0;

  for (const item of view.items) {
    const name = String(item.name ?? item.symbol ?? "持仓标的");
    const symbol = String(item.symbol ?? "");
    const pnlRate = item.unrealizedPnlRate;
    const baseMetadata = { instrumentId: item.instrumentId, symbol, name, dataAsOf };
    if (pnlRate !== null && pnlRate <= -0.08) {
      const urgent = pnlRate <= -0.15;
      created += insertNotification(db, {
        userId, severity: urgent ? "urgent" : "important",
        title: `${name} 持仓亏损${urgent ? "已进入高风险区" : "达到复核线"}`,
        body: `当前相对持仓成本收益率为 ${formatPercent(pnlRate)}。请先核对原投资逻辑、仓位占比和可承受回撤，再决定是否调整。`,
        sourceType: "PORTFOLIO_RISK", sourceId: String(item.instrumentId), groupKey: `holding:${item.instrumentId}:loss`,
        dedupeKey: `${userId}:holding-loss:${item.instrumentId}:${urgent ? "urgent" : "important"}:${dataBucket}`, dataAsOf,
        metadata: { ...baseMetadata, rule: "HOLDING_LOSS", metricValue: pnlRate, threshold: urgent ? -0.15 : -0.08, advisorPrompt: advisorPrompt(name, symbol, "持仓亏损", pnlRate, dataAsOf) },
      });
    }
    if (pnlRate !== null && pnlRate >= 0.15) {
      created += insertNotification(db, {
        userId, severity: pnlRate >= 0.3 ? "important" : "attention", title: `${name} 浮盈达到止盈复核线`,
        body: `当前相对持仓成本浮盈 ${formatPercent(pnlRate)}。这不是自动卖出信号，建议结合目标仓位、估值与持有期限检查是否分批止盈。`,
        sourceType: "PORTFOLIO_GAIN", sourceId: String(item.instrumentId), groupKey: `holding:${item.instrumentId}:gain`,
        dedupeKey: `${userId}:holding-gain:${item.instrumentId}:${pnlRate >= 0.3 ? "high" : "normal"}:${dataBucket}`, dataAsOf,
        metadata: { ...baseMetadata, rule: "UNREALIZED_GAIN", metricValue: pnlRate, threshold: 0.15, advisorPrompt: advisorPrompt(name, symbol, "浮盈止盈复核", pnlRate, dataAsOf) },
      });
    }
    if (item.weight >= 0.35) {
      const urgent = item.weight >= 0.5;
      created += insertNotification(db, {
        userId, severity: urgent ? "urgent" : "important", title: `${name} 单一持仓占比${urgent ? "过高" : "偏高"}`,
        body: `该标的占当前投资资产 ${formatPercent(item.weight)}，组合对单一标的波动较敏感。建议先做减仓情景模拟，再考虑真实决策。`,
        sourceType: "CONCENTRATION_RISK", sourceId: String(item.instrumentId), groupKey: `holding:${item.instrumentId}:concentration`,
        dedupeKey: `${userId}:concentration:${item.instrumentId}:${urgent ? "urgent" : "important"}:${dataBucket}`, dataAsOf,
        metadata: { ...baseMetadata, rule: "CONCENTRATION", metricValue: item.weight, threshold: urgent ? 0.5 : 0.35, advisorPrompt: advisorPrompt(name, symbol, "持仓集中度", item.weight, dataAsOf) },
      });
    }
    const previousPrice = previousPrices.get(String(item.instrumentId));
    if (previousPrice?.gt(0)) {
      const move = new Decimal(String(item.marketPrice)).div(previousPrice).minus(1);
      if (move.abs().gte(0.05)) {
        created += insertNotification(db, {
          userId, severity: move.abs().gte(0.08) ? "important" : "attention",
          title: `${name} 较上次快照${move.gte(0) ? "上涨" : "下跌"} ${formatPercent(move.toNumber(), false)}`,
          body: `价格由 ${previousPrice.toDecimalPlaces(4).toString()} 变为 ${new Decimal(String(item.marketPrice)).toDecimalPlaces(4).toString()}。请区分短期波动与投资逻辑变化。`,
          sourceType: "MARKET_MOVE", sourceId: String(item.instrumentId), groupKey: `holding:${item.instrumentId}:market-move`,
          dedupeKey: `${userId}:market-move:${item.instrumentId}:${move.gte(0) ? "up" : "down"}:${dataBucket}`, dataAsOf,
          metadata: { ...baseMetadata, rule: "SNAPSHOT_MOVE", metricValue: move.toNumber(), previousValue: previousPrice.toNumber(), currentValue: item.marketPrice, advisorPrompt: advisorPrompt(name, symbol, "价格异动", move.toNumber(), dataAsOf) },
        });
      }
    }
  }

  if (metrics && metrics.riskScore >= 70) {
    created += insertNotification(db, {
      userId, severity: metrics.riskScore >= 85 ? "urgent" : "important", title: "组合风险评分进入重点复核区",
      body: `当前风险评分为 ${metrics.riskScore}/100。建议优先检查集中度、回撤和压力测试结果。`,
      sourceType: "PORTFOLIO_HEALTH", sourceId: String(view.portfolioSnapshotId), groupKey: "portfolio:risk-score",
      dedupeKey: `${userId}:portfolio-risk:${metrics.riskScore >= 85 ? "urgent" : "important"}:${dataBucket}`, dataAsOf,
      metadata: { rule: "PORTFOLIO_RISK_SCORE", metricValue: metrics.riskScore, threshold: 70, dataAsOf, advisorPrompt: `请基于 ${dataAsOf} 的最新组合快照解释风险评分 ${metrics.riskScore}/100，列出最主要风险、反方证据和三种可模拟的调整方案。` },
    });
  }
  if (String(view.dataQuality).toUpperCase() !== "COMPLETE") {
    created += insertNotification(db, {
      userId, severity: "information", title: "本次组合行情仅部分更新",
      body: "部分标的沿用了最近一次有效价格。涉及这些标的的收益率与风险结论应按较低置信度理解。",
      sourceType: "DATA_QUALITY", sourceId: String(view.portfolioSnapshotId), groupKey: "portfolio:data-quality",
      dedupeKey: `${userId}:data-quality:${view.portfolioSnapshotId}`, dataAsOf,
      metadata: { rule: "PARTIAL_DATA", dataQuality: view.dataQuality, sourceStatuses: view.sourceStatuses, dataAsOf },
    });
  }
  if (Date.now() - Date.parse(dataAsOf) > STALE_DATA_MS) {
    const currentBucket = new Date().toISOString().slice(0, 10);
    created += insertNotification(db, {
      userId, severity: "attention", title: "持仓行情已超过 72 小时未更新",
      body: `最近一次有效持仓快照为 ${formatDateTime(dataAsOf)}。在行情恢复前，不建议依据旧价格做高确定性判断。`,
      sourceType: "DATA_FRESHNESS", sourceId: String(view.portfolioSnapshotId), groupKey: "portfolio:data-freshness",
      dedupeKey: `${userId}:data-stale:${currentBucket}`, dataAsOf, metadata: { rule: "STALE_DATA", dataAsOf },
    });
  }
  db.close();
  return created;
}

function previousSnapshotPrices(db: ReturnType<typeof getDatabase>, userId: string, currentSnapshotId: unknown): Map<string, Decimal> {
  const current = db.prepare("SELECT portfolio_id FROM portfolio_snapshots WHERE id=? AND user_id=?").get(currentSnapshotId, userId) as { portfolio_id?: string } | undefined;
  if (!current?.portfolio_id) return new Map();
  const previous = db.prepare("SELECT id FROM portfolio_snapshots WHERE user_id=? AND portfolio_id=? AND id<>? ORDER BY as_of DESC,created_at DESC LIMIT 1").get(userId, current.portfolio_id, currentSnapshotId) as { id?: string } | undefined;
  if (!previous?.id) return new Map();
  const rows = db.prepare("SELECT instrument_id,price_decimal FROM holding_snapshots WHERE portfolio_snapshot_id=?").all(previous.id) as Array<{ instrument_id: string; price_decimal: string }>;
  return new Map(rows.map((row) => [row.instrument_id, new Decimal(row.price_decimal)]));
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function dateBucket(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 8 ? digits.slice(0, 8) : value.slice(0, 10);
}
