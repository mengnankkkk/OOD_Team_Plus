import { executePandaSources, type PandaSourceExecution } from "@/server/extensions/query/panda-query-executor";
import type { PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { getDatabase } from "@/server/http/context";
import aShareStocks from "@/data/a-share-stocks.json";

export interface DebateEvidenceBoard {
  debateSessionId: string;
  rootAgentRunId: string;
  motion: string;
  targetSymbol: string | null;
  profileFacts: string[];
  portfolioFacts: string[];
  marketFacts: string[];
  userClaims: string[];
  missingData: string[];
  pandaExecutions: PandaSourceExecution[];
}

type DebateEvidenceDbCall = typeof executePandaSources;
type Row = Record<string, unknown>;

export async function buildDebateEvidenceBoard(input: {
  userId: string;
  debateSessionId: string;
  rootAgentRunId: string;
  motion: string;
  targetSymbol?: string | null;
  userClaims?: string[];
  dbCall?: DebateEvidenceDbCall;
}): Promise<DebateEvidenceBoard> {
  const db = getDatabase();
  try {
    const profile = db.prepare(`SELECT
      risk_level,investment_amount_decimal,horizon,max_drawdown_decimal
      FROM user_profiles WHERE user_id=?`).get(input.userId) as Row | undefined;
    const snapshot = db.prepare(`SELECT id FROM portfolio_snapshots
      WHERE user_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1`).get(input.userId) as Row | undefined;
    const holdings = snapshot
      ? db.prepare(`SELECT hs.*,i.symbol,i.name,i.asset_type,i.market
          FROM holding_snapshots hs
          JOIN instruments i ON i.id=hs.instrument_id
          WHERE hs.portfolio_snapshot_id=?
          ORDER BY hs.weight_bps DESC,hs.id`).all(snapshot.id) as Row[]
      : [];
    const resolvedTargetSymbol = input.targetSymbol ?? resolveTargetSymbolFromMotion(db, input.motion);
    const target = resolvedTargetSymbol
      ? db.prepare(`SELECT id,symbol,name,asset_type,market FROM instruments
          WHERE UPPER(symbol)=UPPER(?) LIMIT 1`).get(resolvedTargetSymbol) as Row | undefined
      : undefined;
    const targetForResearch = target ?? aShareTarget(resolvedTargetSymbol);

    const source = targetForResearch ? pandaSourceFor(targetForResearch) : null;
    const pandaExecutions = source
      ? await fetchMarketEvidence(input.dbCall ?? executePandaSources, source, input.rootAgentRunId, db)
      : [];
    const marketFacts = marketEvidenceFacts(pandaExecutions);

    return {
      debateSessionId: input.debateSessionId,
      rootAgentRunId: input.rootAgentRunId,
      motion: input.motion,
      targetSymbol: resolvedTargetSymbol,
      profileFacts: profileEvidenceFacts(profile),
      portfolioFacts: portfolioEvidenceFacts(holdings),
      marketFacts,
      userClaims: [...(input.userClaims ?? [])],
      missingData: missingEvidence({
        hasProfile: Boolean(profile),
        hasHoldings: holdings.length > 0,
        requestedTarget: Boolean(input.targetSymbol || resolvedTargetSymbol),
        hasTarget: Boolean(targetForResearch),
        requestedMarketData: Boolean(source),
        hasMarketFacts: marketFacts.length > 0,
      }),
      pandaExecutions,
    };
  } finally {
    db.close();
  }
}

function resolveTargetSymbolFromMotion(
  db: ReturnType<typeof getDatabase>,
  motion: string,
): string | null {
  const normalizedMotion = normalizeInstrumentText(motion);
  if (!normalizedMotion) return null;
  const rows = db.prepare(`
    SELECT symbol,name
    FROM instruments
    WHERE name IS NOT NULL AND LENGTH(name) >= 2
  `).all() as Array<{ symbol?: unknown; name?: unknown }>;
  return rows
    .map((row) => ({
      symbol: typeof row.symbol === "string" ? row.symbol.trim() : "",
      name: typeof row.name === "string" ? row.name.trim() : "",
    }))
    .filter((row) => row.symbol && row.name)
    .filter((row) => normalizedMotion.includes(normalizeInstrumentText(row.name)))
    .sort((left, right) => right.name.length - left.name.length)[0]?.symbol
    ?? (aShareStocks as Array<{ code: string; name: string }>)
      .filter((stock) => normalizedMotion.includes(normalizeInstrumentText(stock.name)))
      .sort((left, right) => right.name.length - left.name.length)
      .map((stock) => `${stock.code}.${stock.code.startsWith("6") ? "SH" : "SZ"}`)[0]
    ?? null;
}

function normalizeInstrumentText(value: string): string {
  return value.replace(/[\s·（）()\-—_]/gu, "").toLowerCase();
}

function aShareTarget(symbol: string | null): Row | undefined {
  if (!symbol) return undefined;
  const code = symbol.match(/^\d{6}/u)?.[0];
  if (!code) return undefined;
  const stock = (aShareStocks as Array<{ code: string; name: string }>).find((item) => item.code === code);
  if (!stock) return undefined;
  return {
    symbol: `${stock.code}.${stock.code.startsWith("6") ? "SH" : "SZ"}`,
    name: stock.name,
    asset_type: "STOCK",
    market: stock.code.startsWith("6") ? "SH" : "SZ",
  };
}

async function fetchMarketEvidence(
  dbCall: DebateEvidenceDbCall,
  source: PandaQuerySource,
  rootAgentRunId: string,
  db: ReturnType<typeof getDatabase>,
): Promise<PandaSourceExecution[]> {
  try {
    return await dbCall({
      sources: [source],
      agentRunId: rootAgentRunId,
      localRows: [],
      db,
    });
  } catch {
    return [];
  }
}

function profileEvidenceFacts(profile: Row | undefined): string[] {
  if (!profile) return [];
  return [
    `风险等级：${factValue(profile.risk_level)}`,
    `可投资金额：${factValue(profile.investment_amount_decimal)}`,
    `投资期限：${factValue(profile.horizon)}`,
    `最大回撤：${factValue(profile.max_drawdown_decimal)}`,
  ];
}

function portfolioEvidenceFacts(holdings: Row[]): string[] {
  return holdings.map((holding) => [
    `${factValue(holding.symbol)} ${factValue(holding.name)}`,
    `权重 ${factValue(holding.weight_bps)}bps`,
    `浮盈亏 ${factValue(holding.unrealized_pnl_decimal)}`,
  ].join("，"));
}

function marketEvidenceFacts(executions: PandaSourceExecution[]): string[] {
  return executions.flatMap((execution) => execution.result.data.slice(0, 3).map((row) => [
    factValue(row.symbol ?? execution.source.parameters.symbol ?? execution.source.dataset),
    factValue(row.date ?? row.trade_date ?? execution.result.asOfDate),
    `close=${factValue(row.close)}`,
    execution.result.fresh ? "数据新鲜" : "数据已过期",
  ].join("，")));
}

function missingEvidence(input: {
  hasProfile: boolean;
  hasHoldings: boolean;
  requestedTarget: boolean;
  hasTarget: boolean;
  requestedMarketData: boolean;
  hasMarketFacts: boolean;
}): string[] {
  return [
    input.hasProfile ? null : "profile",
    input.hasHoldings ? null : "holdings",
    input.requestedTarget && !input.hasTarget ? "target_instrument" : null,
    input.requestedMarketData && !input.hasMarketFacts ? "market_data" : null,
  ].filter((value): value is string => value !== null);
}

function pandaSourceFor(target: Row): PandaQuerySource {
  const symbol = factValue(target.symbol);
  const assetType = factValue(target.asset_type).toUpperCase();
  const market = factValue(target.market).toUpperCase();
  const method = assetType.includes("ETF") || assetType.includes("FUND")
    ? "get_fund_daily"
    : assetType.includes("INDEX")
      ? "get_index_daily"
      : market === "US"
        ? "get_us_daily"
        : market === "HK"
          ? "get_hk_daily"
      : "get_stock_daily";
  const endDate = compactUtcDate(new Date());
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 180);
  const columns = ["symbol", "date", "open", "high", "low", "close", "volume", "amount"];

  return {
    dataset: method === "get_fund_daily"
      ? "MARKET_FUND_DAILY"
      : method === "get_index_daily"
        ? "MARKET_INDEX_DAILY"
        : method === "get_us_daily"
          ? "MARKET_US_DAILY"
          : method === "get_hk_daily"
            ? "MARKET_HK_DAILY"
          : "MARKET_STOCK_DAILY",
    method,
    parameters: { symbol: [symbol], start_date: compactUtcDate(startDate), end_date: endDate, fields: columns },
    columns,
    joinKeys: ["symbol", "date"],
    assetType,
  };
}

function compactUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function factValue(value: unknown): string {
  return value === null || value === undefined || value === "" ? "未知" : String(value);
}
