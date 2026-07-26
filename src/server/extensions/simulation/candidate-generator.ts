import { createHash } from "node:crypto";

import Decimal from "decimal.js";

import type { SqliteDb } from "@/server/db/client.runtime";
import { calculatePortfolioMetrics, runPortfolioStressTests, STRESS_PARAMETER_VERSION } from "@/server/extensions/analysis/financial-engine";
import type { PandaDataMethod } from "@/server/extensions/pandadata/adapter";
import { executePandaSources } from "@/server/extensions/query/panda-query-executor";
import type { MarketDatasetKey, PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { getDatabase, parseJson } from "@/server/http/context";
import type { BranchScenarioOption, BranchScenarioPlan } from "./scenario-contracts";
import { runBranchScenarioAgent } from "./scenario-agent";
import { completeScenarioEvidence, type ScenarioResearchRecord } from "./scenario-evidence";

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
  targetAllocations: Array<{ instrumentId: string; weight: string }>;
  tradeIntent: string;
  analysis: {
    strategy: "HOLD" | "BALANCED" | "DEFENSIVE" | "GROWTH";
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    forecast: { expectedReturn: number; bullCaseReturn: number; bearCaseReturn: number; annualVolatility: number | null; maxDrawdown: number; concentrationHHI: number };
    rationale: string[];
    counterEvidence: string[];
    risks: string[];
    assumptions: string[];
    invalidationConditions?: string[];
    stressTests: ReturnType<typeof runPortfolioStressTests>;
  };
}

export type CandidateGenerationHooks = {
  agentRunId?: string;
  onAgentStarted?: (role: string, label: string) => void;
  onAgentCompleted?: (role: string, summary: string) => void;
};

export interface PriceManifest {
  prices: Record<string, string>;
  assets?: Record<string, { assetType: string; sector: string | null }>;
  feeRate?: string;
  sha256: string;
  capturedAt: string;
}

type HoldingRow = {
  instrument_id: string;
  quantity_decimal: string;
  price_decimal: string;
  market_value_decimal: string;
  symbol?: string;
  name?: string;
  asset_type?: string;
  sector?: string | null;
};

export type ScenarioInstrument = {
  id: string;
  symbol: string;
  market?: string;
  asset_type?: string;
  sector?: string | null;
  raw_payload_json?: string;
  freshness_status?: string;
  quality_status?: string;
};

export type ScenarioNormalizationContext = {
  objective: string;
  parentCash: string;
  holdings: Array<{ instrumentId: string; quantity: string; marketValue: string }>;
  allowedInstrumentIds: Set<string>;
  priceManifest: PriceManifest;
  riskAssumption?: string;
  research?: ScenarioResearchRecord[];
};

export async function generateCandidates(
  objective: string,
  portfolioSnapshotId: string,
  activeBranchId?: string,
  userId?: string,
  hooks: CandidateGenerationHooks = {},
): Promise<{ candidates: SimulationCandidate[]; priceManifest: PriceManifest; provider: BranchScenarioPlan["provider"]; delegatedAgents: string[]; fallbackReason?: string }> {
  const db = getDatabase();
  const rows = (activeBranchId
    ? db.prepare(`SELECT h.instrument_id,h.quantity_decimal,h.price_decimal,h.market_value_decimal,i.symbol,i.name,i.asset_type,i.sector
      FROM simulation_asset_snapshot_items h JOIN simulation_asset_snapshots s ON s.id=h.snapshot_id
      LEFT JOIN instruments i ON i.id=h.instrument_id WHERE s.branch_id=?`).all(activeBranchId)
    : db.prepare(`SELECT h.instrument_id,h.quantity_decimal,h.price_decimal,h.market_value_decimal,i.symbol,i.name,i.asset_type,i.sector
      FROM holding_snapshots h LEFT JOIN instruments i ON i.id=h.instrument_id WHERE h.portfolio_snapshot_id=?`).all(portfolioSnapshotId)) as HoldingRow[];
  const parentSnapshot = (activeBranchId
    ? db.prepare("SELECT cash_decimal FROM simulation_asset_snapshots WHERE branch_id=?").get(activeBranchId)
    : db.prepare("SELECT cash_decimal FROM portfolio_snapshots WHERE id=?").get(portfolioSnapshotId)) as { cash_decimal?: string } | undefined;
  const profile = userId ? db.prepare("SELECT max_drawdown_decimal FROM user_profiles WHERE user_id=?").get(userId) as { max_drawdown_decimal?: string } | undefined : undefined;
  const instruments = db.prepare(`SELECT i.id,i.symbol,i.name,i.market,i.asset_type,i.sector,ms.raw_payload_json,ms.freshness_status,ms.quality_status
    FROM instruments i LEFT JOIN market_snapshots ms ON ms.id=(SELECT id FROM market_snapshots m WHERE m.instrument_id=i.id ORDER BY m.as_of DESC LIMIT 1)
    WHERE i.tradable=1 ORDER BY i.symbol`).all() as Array<Record<string, unknown>>;
  db.close();

  const sortedRows = [...rows].sort((a, b) => decimal(b.market_value_decimal).comparedTo(decimal(a.market_value_decimal)));
  const prices: Record<string, string> = {};
  const assets: NonNullable<PriceManifest["assets"]> = {};
  for (const row of sortedRows) {
    const quantity = nonNegative(row.quantity_decimal);
    const storedPrice = decimalOrNull(row.price_decimal);
    const storedValue = nonNegative(row.market_value_decimal);
    const price = storedPrice?.gt(0) ? storedPrice : quantity.gt(0) ? storedValue.div(quantity) : null;
    if (!price?.gt(0)) throw new Error(`MISSING_FROZEN_PRICE:${row.instrument_id}`);
    prices[row.instrument_id] = clean(price);
    assets[row.instrument_id] = { assetType: row.asset_type ?? "UNKNOWN", sector: row.sector ?? null };
  }

  const heldIds = new Set(sortedRows.map((row) => row.instrument_id));
  const heldDiversifier = sortedRows.find((row) => /FUND|ETF|INDEX/iu.test(String(row.asset_type)) && prices[row.instrument_id]);
  const target = heldDiversifier
    ? { id: heldDiversifier.instrument_id, asset_type: heldDiversifier.asset_type, sector: heldDiversifier.sector }
    : instruments.find((instrument) => !heldIds.has(String(instrument.id)) && /FUND|ETF|INDEX/iu.test(String(instrument.asset_type)) && freshPrice(instrument) != null)
    ?? instruments.find((instrument) => !heldIds.has(String(instrument.id)) && freshPrice(instrument) != null);
  if (target && !prices[String(target.id)]) {
    prices[String(target.id)] = clean(freshPrice(target)!);
    assets[String(target.id)] = { assetType: String(target.asset_type ?? "UNKNOWN"), sector: target.sector == null ? null : String(target.sector) };
  }

  const instrumentById = new Map(instruments.map((instrument) => [String(instrument.id), instrument]));
  const researchInstruments = [...new Set([
    ...sortedRows.map((row) => row.instrument_id),
    target ? String(target.id) : "",
  ])].flatMap((instrumentId) => {
    const instrument = instrumentById.get(instrumentId);
    return instrument ? [toScenarioInstrument(instrument)] : [];
  });
  hooks.onAgentStarted?.("DATA_RESEARCH", `从数据源整理 ${researchInstruments.length} 个相关标的的行情序列`);
  const research = await fetchScenarioResearch(researchInstruments, hooks.agentRunId);
  hooks.onAgentCompleted?.("DATA_RESEARCH", `已整理 ${research.length} 条研究记录，提供给候选 Agent 总结依据、反方证据和风险`);

  const capturedAt = new Date().toISOString();
  const priceManifest: PriceManifest = { prices, assets, feeRate: "0.001", capturedAt, sha256: "" };
  priceManifest.sha256 = hashPriceManifest(priceManifest);
  const cash = String(parentSnapshot?.cash_decimal ?? "0");
  const riskBudget = normalizeRiskBudget(profile?.max_drawdown_decimal);
  const largest = sortedRows[0];
  const currentPortfolio = calculatePortfolioMetrics(cash, toFinancialHoldings(sortedRows, prices, assets));
  const currentLargestWeight = decimal(currentPortfolio.largestPositionWeight);
  const concentrationShock = new Decimal("0.30");
  const combinedShock = new Decimal("0.35");
  const balancedCap = Decimal.min(currentLargestWeight, riskBudget.value.div(concentrationShock), new Decimal("0.95"));
  const defensiveCap = Decimal.min(currentLargestWeight, riskBudget.value.div(combinedShock), balancedCap);
  const balancedTrades = buildRebalanceTrades(largest, sortedRows, target, prices, balancedCap, decimal(priceManifest.feeRate!));
  const defensiveTrades = buildRebalanceTrades(largest, sortedRows, target, prices, defensiveCap, decimal(priceManifest.feeRate!));
  const candidateInputs = [
    { label: "A · 保持观察", description: `保持当前组合不变，继续观察“${objective}”`, strategy: "HOLD" as const, trades: [] as SimulationCandidate["trades"], intent: "保持当前资产，不产生模拟成交" },
    { label: "B · 风险预算再平衡", description: `按最大回撤预算把最大持仓目标权重约束到 ${percent(balancedCap)}`, strategy: "BALANCED" as const, trades: balancedTrades, intent: target ? "降低最大持仓并用有真实冻结价格的分散标的承接" : "降低最大持仓并保留为现金" },
    { label: "C · 压力约束降险", description: `按集中持仓与流动性联合压力把最大持仓目标权重约束到 ${percent(defensiveCap)}`, strategy: "DEFENSIVE" as const, trades: defensiveTrades, intent: target ? "在更严格压力预算下再平衡" : "在更严格压力预算下增加现金缓冲" },
  ];
  let provider: BranchScenarioPlan["provider"] = "DETERMINISTIC_FALLBACK";
  let delegatedAgents = ["DETERMINISTIC_FALLBACK"];
  let fallbackReason: string | undefined;
  let candidates: SimulationCandidate[];
  const scenario = await runBranchScenarioAgent({
    objective,
    profile: profile ? { ...profile } : null,
    snapshot: { ...parentSnapshot, portfolioSnapshotId },
    holdings: sortedRows.map((row) => ({ ...row })),
    instruments,
    research,
    riskConstraints: { maxDrawdown: riskBudget.value.toString(), assumption: riskBudget.assumption },
  }, hooks);
  provider = scenario.provider;
  delegatedAgents = scenario.delegatedAgents;
  fallbackReason = scenario.fallbackReason;

  if (provider === "CHIEF_ADVISOR") {
    const missingInstrumentIds = referencedInstrumentIds(scenario.plan.options)
      .filter((instrumentId) => !priceManifest.prices[instrumentId]);
    const missingInstruments = missingInstrumentIds.flatMap((instrumentId) => {
      const instrument = instrumentById.get(instrumentId);
      return instrument ? [toScenarioInstrument(instrument)] : [];
    });
    if (missingInstruments.length && hooks.agentRunId) {
      hooks.onAgentStarted?.("PRICE_RESOLVER", `为 ${missingInstruments.length} 个模型候选标的补取冻结价格`);
      const fetchedPrices = await fetchScenarioInstrumentPrices(missingInstruments, hooks.agentRunId);
      for (const instrument of missingInstruments) {
        const price = fetchedPrices[instrument.id];
        if (!price) continue;
        priceManifest.prices[instrument.id] = price;
        priceManifest.assets![instrument.id] = {
          assetType: instrument.asset_type ?? "UNKNOWN",
          sector: instrument.sector ?? null,
        };
      }
      if (Object.keys(fetchedPrices).length) {
        priceManifest.capturedAt = new Date().toISOString();
        priceManifest.sha256 = hashPriceManifest(priceManifest);
      }
      hooks.onAgentCompleted?.(
        "PRICE_RESOLVER",
        `已补取 ${Object.keys(fetchedPrices).length}/${missingInstruments.length} 个模型候选标的价格`,
      );
    }

    const normalized = normalizeValidScenarioOptions(scenario.plan.options, {
      objective,
      parentCash: cash,
      holdings: sortedRows.map((row) => ({
        instrumentId: row.instrument_id,
        quantity: row.quantity_decimal,
        marketValue: row.market_value_decimal,
      })),
      allowedInstrumentIds: new Set(Object.keys(priceManifest.prices)),
      priceManifest,
      riskAssumption: riskBudget.assumption,
      research,
    });
    for (const rejection of normalized.rejections) {
      hooks.onAgentCompleted?.("SCENARIO_VALIDATOR", `候选 ${rejection.sequenceNo + 1} 未通过交易校验，已跳过：${rejection.message}`);
    }
    if (normalized.candidates.length) {
      candidates = normalized.candidates;
    } else {
      hooks.onAgentCompleted?.("SCENARIO_VALIDATOR", "所有模型候选均不可执行，已降级为确定性方案");
      provider = "DETERMINISTIC_FALLBACK";
      delegatedAgents = ["DETERMINISTIC_FALLBACK"];
      fallbackReason = "SCENARIO_VALIDATION_FAILED";
      candidates = candidateInputs.map((input, sequenceNo) => buildCandidate(sequenceNo, input, objective, cash, sortedRows, priceManifest, riskBudget.assumption, research));
    }
  } else {
    candidates = candidateInputs.map((input, sequenceNo) => buildCandidate(sequenceNo, input, objective, cash, sortedRows, priceManifest, riskBudget.assumption, research));
  }
  return { candidates, priceManifest, provider, delegatedAgents, fallbackReason };
}

export function normalizeScenarioOption(
  option: BranchScenarioOption,
  context: ScenarioNormalizationContext & { sequenceNo?: number },
): SimulationCandidate {
  const quantities = new Map(context.holdings.map((holding) => [holding.instrumentId, decimal(holding.quantity)]));
  let cash = nonNegative(context.parentCash);
  const normalizedTrades = [...option.trades].sort((left, right) => left.action === right.action ? 0 : left.action === "SELL" ? -1 : 1);
  const trades = normalizedTrades.flatMap((trade) => {
    if (!context.allowedInstrumentIds.has(trade.instrumentId) || !context.priceManifest.prices[trade.instrumentId]) {
      throw new Error(`SCENARIO_UNKNOWN_INSTRUMENT:${trade.instrumentId}`);
    }
    let quantity = positiveDecimal(trade.quantity, `scenarioQuantity:${trade.instrumentId}`);
    const price = decimal(context.priceManifest.prices[trade.instrumentId]);
    const feeRate = decimal(context.priceManifest.feeRate ?? "0.001");
    const current = quantities.get(trade.instrumentId) ?? new Decimal(0);
    if (trade.action === "SELL") {
      quantity = Decimal.min(quantity, current).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      if (!quantity.gt(0)) return [];
      const notional = quantity.mul(price);
      quantities.set(trade.instrumentId, current.minus(quantity));
      const fee = notional.mul(feeRate);
      cash = cash.plus(notional.minus(fee));
    } else {
      const maxQuantity = cash.div(price.mul(new Decimal(1).plus(feeRate))).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      quantity = Decimal.min(quantity, maxQuantity);
      if (!quantity.gt(0)) return [];
      const notional = quantity.mul(price);
      const fee = notional.mul(feeRate);
      quantities.set(trade.instrumentId, current.plus(quantity));
      cash = cash.minus(notional.plus(fee));
    }
    return [{ instrumentId: trade.instrumentId, action: trade.action, quantity: clean(quantity), price: clean(price) }];
  });
  const rows: HoldingRow[] = context.holdings.map((holding) => ({
    instrument_id: holding.instrumentId,
    quantity_decimal: holding.quantity,
    price_decimal: context.priceManifest.prices[holding.instrumentId],
    market_value_decimal: holding.marketValue,
    asset_type: context.priceManifest.assets?.[holding.instrumentId]?.assetType,
    sector: context.priceManifest.assets?.[holding.instrumentId]?.sector,
  }));
  return buildCandidate(
    context.sequenceNo ?? 0,
    {
      label: option.label,
      description: option.description,
      strategy: option.strategy,
      trades,
      intent: option.description,
      evidence: option,
    },
    context.objective,
    context.parentCash,
    rows,
    context.priceManifest,
    context.riskAssumption ?? "风险预算由分支模拟上下文提供",
    context.research,
  );
}

export function normalizeValidScenarioOptions(
  options: BranchScenarioOption[],
  context: ScenarioNormalizationContext,
): {
  candidates: SimulationCandidate[];
  rejections: Array<{ sequenceNo: number; message: string }>;
} {
  const candidates: SimulationCandidate[] = [];
  const rejections: Array<{ sequenceNo: number; message: string }> = [];
  for (const [sequenceNo, option] of options.entries()) {
    try {
      candidates.push(normalizeScenarioOption(option, { ...context, sequenceNo }));
    } catch (error) {
      rejections.push({ sequenceNo, message: safeMessage(error) });
    }
  }
  return { candidates, rejections };
}

export async function fetchScenarioInstrumentPrices(
  instruments: ScenarioInstrument[],
  agentRunId: string,
  execute: typeof executePandaSources = executePandaSources,
): Promise<Record<string, string>> {
  const grouped = new Map<PandaDataMethod, ScenarioInstrument[]>();
  for (const instrument of instruments) {
    const method = marketMethod(instrument);
    grouped.set(method, [...(grouped.get(method) ?? []), instrument]);
  }
  const prices: Record<string, string> = {};
  const db = getDatabase() as unknown as SqliteDb;
  try {
    for (const [preferredMethod, groupedInstruments] of grouped) {
      let unresolved = groupedInstruments;
      const methods: PandaDataMethod[] = preferredMethod === "get_stock_rt_daily"
        ? ["get_stock_rt_daily", "get_stock_daily"]
        : [preferredMethod];
      for (const method of methods) {
        if (!unresolved.length) break;
        try {
          const source = scenarioPriceSource(method, unresolved.map((instrument) => instrument.symbol));
          const [execution] = await execute({ sources: [source], agentRunId, localRows: [], db });
          const latestBySymbol = latestPrices(execution?.result.data ?? []);
          unresolved = unresolved.filter((instrument) => {
            const price = latestBySymbol.get(instrument.symbol.toUpperCase());
            if (!price) return true;
            prices[instrument.id] = price;
            return false;
          });
        } catch {
          // A missing quote should reject only the affected option, not the full model batch.
        }
      }
    }
  } finally {
    db.close();
  }
  return prices;
}

export async function fetchScenarioResearch(
  instruments: ScenarioInstrument[],
  agentRunId: string | undefined,
  execute: typeof executePandaSources = executePandaSources,
): Promise<ScenarioResearchRecord[]> {
  const localRecords = new Map(instruments.map((instrument) => [instrument.id, localResearchRecord(instrument)]));
  if (!agentRunId || !instruments.length) return [...localRecords.values()];

  const grouped = new Map<PandaDataMethod, ScenarioInstrument[]>();
  for (const instrument of instruments) {
    const method = marketMethod(instrument);
    grouped.set(method, [...(grouped.get(method) ?? []), instrument]);
  }
  const db = getDatabase() as unknown as SqliteDb;
  try {
    for (const [preferredMethod, groupedInstruments] of grouped) {
      let unresolved = groupedInstruments;
      const methods: PandaDataMethod[] = preferredMethod === "get_stock_rt_daily"
        ? ["get_stock_rt_daily", "get_stock_daily"]
        : [preferredMethod];
      for (const method of methods) {
        if (!unresolved.length) break;
        try {
          const source = scenarioResearchSource(method, unresolved.map((instrument) => instrument.symbol));
          const [execution] = await execute({ sources: [source], agentRunId, localRows: [], db });
          const rowsBySymbol = new Map<string, Array<Record<string, unknown>>>();
          for (const row of execution?.result.data ?? []) {
            const symbol = String(row.symbol ?? row.ts_code ?? row.code ?? "").trim().toUpperCase();
            if (symbol) rowsBySymbol.set(symbol, [...(rowsBySymbol.get(symbol) ?? []), row]);
          }
          unresolved = unresolved.filter((instrument) => {
            const rows = rowsBySymbol.get(instrument.symbol.toUpperCase()) ?? [];
            if (!rows.length) return true;
            localRecords.set(instrument.id, summarizeResearchRows(instrument, rows, method, execution.result.fresh, execution.result.asOfDate));
            return false;
          });
        } catch {
          // Keep the local snapshot and expose the missing source as evidence instead of inventing a trend.
        }
      }
    }
  } finally {
    db.close();
  }
  return [...localRecords.values()];
}

export function hashPriceManifest(manifest: Omit<PriceManifest, "sha256"> | PriceManifest): string {
  const canonical = {
    capturedAt: manifest.capturedAt,
    feeRate: manifest.feeRate ?? "0.001",
    prices: sortRecord(manifest.prices),
    assets: sortRecord(manifest.assets ?? {}),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function buildCandidate(
  sequenceNo: number,
  input: {
    label: string;
    description: string;
    strategy: SimulationCandidate["analysis"]["strategy"];
    trades: SimulationCandidate["trades"];
    intent: string;
    evidence?: Pick<BranchScenarioOption, "rationale" | "counterEvidence" | "risks" | "assumptions" | "invalidationConditions">;
  },
  objective: string,
  parentCash: string,
  rows: HoldingRow[],
  manifest: PriceManifest,
  riskAssumption: string,
  research: ScenarioResearchRecord[] = [],
): SimulationCandidate {
  const projection = project(parentCash, rows, input.trades, manifest);
  const portfolio = calculatePortfolioMetrics(projection.cash, projection.holdings);
  const stressTests = runPortfolioStressTests(projection.cash, projection.holdings);
  const bull = stressTests.find((item) => item.scenario === "BULL")!;
  const bear = stressTests.find((item) => item.scenario === "BEAR")!;
  const worst = stressTests.reduce((value, item) => Decimal.min(value, decimal(item.changeRatio)), new Decimal(0));
  const magnitude = worst.abs();
  const riskLevel = magnitude.gt("0.2") ? "HIGH" : magnitude.gt("0.1") ? "MEDIUM" : "LOW";
  const evidence = completeScenarioEvidence(
    {
      strategy: input.strategy,
      trades: input.trades,
      rationale: input.evidence?.rationale,
      counterEvidence: input.evidence?.counterEvidence,
      risks: input.evidence?.risks,
      assumptions: input.evidence?.assumptions,
      invalidationConditions: input.evidence?.invalidationConditions,
    },
    {
      objective,
      research,
      holdings: rows.map((row) => ({ ...row })),
      riskConstraints: { assumption: riskAssumption },
    },
    {
      concentrationHhi: decimal(portfolio.concentrationHhi).toNumber(),
      bearCaseReturn: decimal(bear.changeRatio).toNumber(),
    },
  );
  return {
    sequenceNo,
    label: input.label,
    description: input.description,
    trades: input.trades,
    targetAllocations: portfolio.holdings.map((item) => ({ instrumentId: item.instrumentId, weight: item.weight })),
    tradeIntent: input.intent,
    analysis: {
      strategy: input.strategy,
      riskLevel,
      forecast: {
        expectedReturn: 0,
        bullCaseReturn: decimal(bull.changeRatio).toNumber(),
        bearCaseReturn: decimal(bear.changeRatio).toNumber(),
        annualVolatility: null,
        maxDrawdown: worst.toNumber(),
        concentrationHHI: decimal(portfolio.concentrationHhi).toNumber(),
      },
      rationale: evidence.rationale,
      counterEvidence: evidence.counterEvidence,
      risks: evidence.risks,
      assumptions: [
        ...evidence.assumptions,
        riskAssumption,
        `交易费率 ${percent(decimal(manifest.feeRate!))}`,
        `压力参数 ${STRESS_PARAMETER_VERSION}`,
        "不使用杠杆、卖空或虚构价格",
      ].slice(0, 8),
      invalidationConditions: evidence.invalidationConditions,
      stressTests,
    },
  };
}

function buildRebalanceTrades(
  largest: HoldingRow | undefined,
  rows: HoldingRow[],
  target: Record<string, unknown> | undefined,
  prices: Record<string, string>,
  targetCap: Decimal,
  feeRate: Decimal,
): SimulationCandidate["trades"] {
  if (!largest || !targetCap.gte(0) || targetCap.gte(1)) return [];
  const largestValue = decimal(largest.market_value_decimal);
  const totalValue = sum(rows.map((row) => decimal(row.market_value_decimal)));
  const sellValue = largestValue.minus(targetCap.mul(totalValue)).div(new Decimal(1).minus(targetCap));
  if (!sellValue.gt(0)) return [];
  const sellPrice = decimal(prices[largest.instrument_id]);
  const availableQuantity = decimal(largest.quantity_decimal);
  const sellQuantity = Decimal.min(availableQuantity, sellValue.div(sellPrice)).toDecimalPlaces(8, Decimal.ROUND_DOWN);
  if (!sellQuantity.gt(0)) return [];
  const trades: SimulationCandidate["trades"] = [{ instrumentId: largest.instrument_id, action: "SELL", quantity: clean(sellQuantity), price: clean(sellPrice) }];
  if (target) {
    const targetId = String(target.id);
    const targetPrice = prices[targetId] ? decimal(prices[targetId]) : null;
    if (targetPrice?.gt(0)) {
      const saleNet = sellQuantity.mul(sellPrice).mul(new Decimal(1).minus(feeRate));
      const buyQuantity = saleNet.div(targetPrice.mul(new Decimal(1).plus(feeRate))).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      if (buyQuantity.gt(0)) trades.push({ instrumentId: targetId, action: "BUY", quantity: clean(buyQuantity), price: clean(targetPrice) });
    }
  }
  return trades;
}

function project(parentCash: string, rows: HoldingRow[], trades: SimulationCandidate["trades"], manifest: PriceManifest) {
  const feeRate = decimal(manifest.feeRate ?? "0.001");
  let cash = nonNegative(parentCash);
  const quantities = new Map(rows.map((row) => [row.instrument_id, nonNegative(row.quantity_decimal)]));
  for (const trade of trades) {
    const quantity = decimal(trade.quantity);
    const price = decimal(manifest.prices[trade.instrumentId]);
    const notional = quantity.mul(price);
    const fee = notional.mul(feeRate);
    const current = quantities.get(trade.instrumentId) ?? new Decimal(0);
    if (trade.action === "BUY") {
      cash = cash.minus(notional.plus(fee));
      quantities.set(trade.instrumentId, current.plus(quantity));
    } else {
      cash = cash.plus(notional.minus(fee));
      quantities.set(trade.instrumentId, current.minus(quantity));
    }
  }
  return {
    cash: clean(cash),
    holdings: [...quantities.entries()].filter(([, quantity]) => quantity.gt(0)).map(([instrumentId, quantity]) => ({
      instrumentId,
      quantity: clean(quantity),
      price: manifest.prices[instrumentId],
      assetType: manifest.assets?.[instrumentId]?.assetType ?? "UNKNOWN",
      sector: manifest.assets?.[instrumentId]?.sector ?? null,
    })),
  };
}

function toFinancialHoldings(rows: HoldingRow[], prices: Record<string, string>, assets: NonNullable<PriceManifest["assets"]>) {
  return rows.map((row) => ({ instrumentId: row.instrument_id, quantity: row.quantity_decimal, price: prices[row.instrument_id], assetType: assets[row.instrument_id].assetType, sector: assets[row.instrument_id].sector }));
}

function freshPrice(instrument: Record<string, unknown>): Decimal | null {
  if (String(instrument.freshness_status).toLowerCase() !== "fresh" || String(instrument.quality_status).toLowerCase() !== "valid") return null;
  const payload = parseJson<Record<string, unknown>>(String(instrument.raw_payload_json ?? "{}"), {});
  return decimalOrNull(payload.close ?? payload.price ?? payload.nav);
}

function referencedInstrumentIds(options: BranchScenarioOption[]): string[] {
  return [...new Set(options.flatMap((option) => option.trades.map((trade) => trade.instrumentId)))];
}

function toScenarioInstrument(instrument: Record<string, unknown>): ScenarioInstrument {
  return {
    id: String(instrument.id),
    symbol: String(instrument.symbol),
    market: instrument.market == null ? undefined : String(instrument.market),
    asset_type: instrument.asset_type == null ? undefined : String(instrument.asset_type),
    sector: instrument.sector == null ? null : String(instrument.sector),
    raw_payload_json: instrument.raw_payload_json == null ? undefined : String(instrument.raw_payload_json),
    freshness_status: instrument.freshness_status == null ? undefined : String(instrument.freshness_status),
    quality_status: instrument.quality_status == null ? undefined : String(instrument.quality_status),
  };
}

function marketMethod(instrument: ScenarioInstrument): PandaDataMethod {
  const market = String(instrument.market ?? "").toUpperCase();
  const symbol = instrument.symbol.toUpperCase();
  const assetType = String(instrument.asset_type ?? "").toLowerCase();
  if (market.includes("HK") || symbol.endsWith(".HK")) return "get_hk_daily";
  if (symbol.endsWith(".SH") || symbol.endsWith(".SZ") || market === "SH" || market === "SZ") {
    if (assetType.includes("fund") || assetType.includes("etf")) return "get_fund_daily";
    if (assetType.includes("index")) return "get_index_daily";
    return "get_stock_rt_daily";
  }
  return "get_us_daily";
}

function scenarioPriceSource(method: PandaDataMethod, symbols: string[]): PandaQuerySource {
  const fields = ["symbol", "date", "close"];
  const parameters: Record<string, unknown> = { symbol: symbols, fields };
  if (method !== "get_stock_rt_daily") {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 35);
    parameters.start_date = compactDate(start);
    parameters.end_date = compactDate(end);
  }
  return {
    dataset: datasetForMethod(method),
    method,
    parameters,
    columns: fields,
    joinKeys: ["symbol", "date"],
    assetType: assetTypeForMethod(method),
  };
}

function scenarioResearchSource(method: PandaDataMethod, symbols: string[]): PandaQuerySource {
  const fields = ["symbol", "date", "open", "high", "low", "close", "volume", "amount"];
  const parameters: Record<string, unknown> = { symbol: symbols, fields };
  if (method !== "get_stock_rt_daily") {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 90);
    parameters.start_date = compactDate(start);
    parameters.end_date = compactDate(end);
  }
  return {
    dataset: datasetForMethod(method),
    method,
    parameters,
    columns: fields,
    joinKeys: ["symbol", "date"],
    assetType: assetTypeForMethod(method),
  };
}

function localResearchRecord(instrument: ScenarioInstrument): ScenarioResearchRecord {
  const payload = parseJson<Record<string, unknown>>(instrument.raw_payload_json ?? "{}", {});
  const close = decimalOrNull(payload.close ?? payload.price ?? payload.nav);
  return {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    source: "LOCAL_MARKET_SNAPSHOT",
    method: instrument.freshness_status ? "stored_snapshot" : "unavailable",
    fresh: instrument.freshness_status?.toLowerCase() === "fresh",
    asOfDate: textValue(payload.date ?? payload.trade_date),
    sampleCount: close ? 1 : 0,
    latestClose: close ? clean(close) : undefined,
    periodStartClose: close ? clean(close) : undefined,
    periodReturn: close ? "0" : undefined,
    periodHigh: close ? clean(close) : undefined,
    periodLow: close ? clean(close) : undefined,
    dataStatus: close && instrument.quality_status?.toLowerCase() === "valid" ? "VALID" : "UNAVAILABLE",
  };
}

function summarizeResearchRows(
  instrument: ScenarioInstrument,
  rows: Array<Record<string, unknown>>,
  method: PandaDataMethod,
  fresh: boolean,
  asOfDate: string | null,
): ScenarioResearchRecord {
  const samples = rows
    .map((row) => ({
      date: textValue(row.date ?? row.trade_date) ?? "",
      close: decimalOrNull(row.close ?? row.price ?? row.nav),
    }))
    .filter((row): row is { date: string; close: Decimal } => Boolean(row.date) && row.close != null && row.close.gt(0))
    .sort((left, right) => left.date.localeCompare(right.date));
  const first = samples[0]?.close;
  const latest = samples.at(-1)?.close;
  const highs = samples.map((sample) => sample.close);
  const periodReturn = first?.gt(0) && latest ? latest.div(first).minus(1).mul(100) : null;
  return {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    source: "PandaData",
    method,
    fresh,
    asOfDate: asOfDate ?? samples.at(-1)?.date ?? null,
    sampleCount: samples.length,
    latestClose: latest ? clean(latest) : undefined,
    periodStartClose: first ? clean(first) : undefined,
    periodReturn: periodReturn ? clean(periodReturn) : "0",
    periodHigh: highs.length ? clean(Decimal.max(...highs)) : undefined,
    periodLow: highs.length ? clean(Decimal.min(...highs)) : undefined,
    dataStatus: fresh ? "VALID" : "STALE",
  };
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function datasetForMethod(method: PandaDataMethod): MarketDatasetKey {
  if (method === "get_fund_daily") return "MARKET_FUND_DAILY";
  if (method === "get_index_daily") return "MARKET_INDEX_DAILY";
  if (method === "get_hk_daily") return "MARKET_HK_DAILY";
  if (method === "get_us_daily") return "MARKET_US_DAILY";
  if (method === "get_stock_rt_daily") return "MARKET_STOCK_RT_DAILY";
  return "MARKET_STOCK_DAILY";
}

function assetTypeForMethod(method: PandaDataMethod): string {
  if (method === "get_fund_daily") return "FUND";
  if (method === "get_index_daily") return "INDEX";
  return "STOCK";
}

function latestPrices(rows: Array<Record<string, unknown>>): Map<string, string> {
  const latest = new Map<string, { date: string; price: string }>();
  for (const row of rows) {
    const symbol = String(row.symbol ?? row.ts_code ?? row.code ?? "").trim().toUpperCase();
    const price = decimalOrNull(row.close ?? row.price ?? row.nav);
    if (!symbol || !price?.gt(0)) continue;
    const date = String(row.date ?? row.trade_date ?? "");
    const current = latest.get(symbol);
    if (!current || date >= current.date) latest.set(symbol, { date, price: clean(price) });
  }
  return new Map([...latest].map(([symbol, value]) => [symbol, value.price]));
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeRiskBudget(value: string | undefined): { value: Decimal; assumption: string } {
  const parsed = value ? decimalOrNull(value) : null;
  if (parsed?.gt(0) && parsed.lt(1)) return { value: parsed, assumption: `最大回撤预算来自用户画像：${percent(parsed)}` };
  return { value: new Decimal("0.08"), assumption: "画像缺失最大回撤时采用 8% 保守模拟预算，并明确标记为默认假设" };
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function decimal(value: unknown): Decimal {
  const result = new Decimal(String(value));
  if (!result.isFinite()) throw new Error("INVALID_SIMULATION_DECIMAL");
  return result;
}

function decimalOrNull(value: unknown): Decimal | null {
  try { return decimal(value); } catch { return null; }
}

function positiveDecimal(value: unknown, field: string): Decimal {
  const result = decimal(value);
  if (!result.gt(0)) throw new Error(`INVALID_POSITIVE_DECIMAL:${field}`);
  return result;
}

function nonNegative(value: unknown): Decimal {
  const result = decimal(value);
  if (result.isNegative()) throw new Error("NEGATIVE_SIMULATION_ASSET");
  return result;
}

function sum(values: Decimal[]): Decimal { return values.reduce((total, value) => total.plus(value), new Decimal(0)); }
function clean(value: Decimal): string { return value.toDecimalPlaces(12).toFixed().replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1"); }
function percent(value: Decimal): string { return `${value.mul(100).toDecimalPlaces(2).toString()}%`; }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 180) : "SCENARIO_VALIDATION_FAILED"; }
