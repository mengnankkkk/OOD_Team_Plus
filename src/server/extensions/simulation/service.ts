/* eslint-disable max-lines */

import { getDatabase, createId, isoNow, json, parseJson } from "@/server/http/context";
import { calculatePortfolioMetrics, runPortfolioStressTests } from "@/server/extensions/analysis/financial-engine";
import { syncPortfolioFromHoldings } from "@/server/extensions/analysis/service";
import { generateCandidates, type PriceManifest, type SimulationCandidate } from "./candidate-generator";
import { executeSimulation } from "./deterministic-engine";
import { persistSseEvent } from "../sse/event-persister";

type Row = Record<string, unknown>;
type ActiveOptionRun = { controller: AbortController; promise: Promise<void> };
type SimulationPortfolioSource = "USER_PORTFOLIO" | "STARTER_PORTFOLIO";

const activeOptionRuns = new Map<string, ActiveOptionRun>();
const OPTION_GENERATION_TIMEOUT_MS = 300_000;

export function createWorkspace(userId: string, input: { label: string; objectiveText: string; portfolioSnapshotId?: string; conversationSessionId?: string; recommendationId?: string }) {
  const resolvedSnapshot = resolvePortfolioSnapshot(userId, input.portfolioSnapshotId);
  const portfolioSnapshotId = resolvedSnapshot.id;
  const db = getDatabase();
  const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE id = ? AND user_id = ?").get(portfolioSnapshotId, userId) as Row | undefined;
  if (!snapshot) { db.close(); throw new Error("Snapshot not found"); }
  const now = isoNow();
  const workspaceId = createId("workspace");
  const branchId = createId("branch");
  const analysisId = createId("analysis");
  const holdings = db.prepare(`SELECT h.*,i.asset_type,i.sector FROM holding_snapshots h
    JOIN instruments i ON i.id=h.instrument_id WHERE h.portfolio_snapshot_id=?`).all(portfolioSnapshotId) as Row[];
  const rootFinancialHoldings = holdings.map((holding) => ({
    instrumentId: String(holding.instrument_id), assetType: String(holding.asset_type), sector: holding.sector == null ? null : String(holding.sector),
    quantity: String(holding.quantity_decimal), price: String(holding.price_decimal), cost: String(holding.cost_decimal),
  }));
  const rootMetrics = calculatePortfolioMetrics(String(snapshot.cash_decimal), rootFinancialHoldings);
  const rootStress = runPortfolioStressTests(String(snapshot.cash_decimal), rootFinancialHoldings);
  const rootWorst = Math.min(0, ...rootStress.map((item) => Number(item.changeRatio)));
  const rootCostBasis = rootFinancialHoldings.reduce((total, holding) => total + Number(holding.cost ?? 0) * Number(holding.quantity), 0).toString();
  const simSnapshotId = createId("sim_snapshot");
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,?,'completed',?,?)").run(analysisId, userId, "simulation_workspace", now, now);
    db.prepare("INSERT INTO simulation_workspaces (id, user_id, conversation_session_id, recommendation_id, portfolio_snapshot_id, label, objective_text, status, root_branch_id, active_branch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)").run(workspaceId, userId, input.conversationSessionId ?? null, input.recommendationId ?? null, portfolioSnapshotId, input.label, input.objectiveText, branchId, branchId, now, now);
    db.prepare("INSERT INTO simulation_branches (id, workspace_id, label, depth, status, created_at, updated_at) VALUES (?, ?, ?, 0, 'active', ?, ?)").run(branchId, workspaceId, "当前组合", now, now);
    db.prepare("INSERT INTO simulation_asset_snapshots (id, workspace_id, branch_id, portfolio_snapshot_id, cash_decimal, total_market_value_decimal, metrics_json, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(simSnapshotId, workspaceId, branchId, portfolioSnapshotId, rootMetrics.cashValue, rootMetrics.totalMarketValue, json({ totalReturn: 0, totalAssets: rootMetrics.totalAssets, costBasis: rootCostBasis, unrealizedPnl: rootMetrics.unrealizedPnl, maxDrawdown: rootWorst, volatility: null, concentrationHHI: Number(rootMetrics.concentrationHhi), expectedReturn: 0, bullCaseReturn: Number(rootStress.find((item) => item.scenario === "BULL")?.changeRatio ?? 0), bearCaseReturn: Number(rootStress.find((item) => item.scenario === "BEAR")?.changeRatio ?? 0), riskLevel: Math.abs(rootWorst) > 0.2 ? "HIGH" : Math.abs(rootWorst) > 0.1 ? "MEDIUM" : "LOW", stressTests: rootStress, missingMetrics: ["ANNUAL_VOLATILITY_REQUIRES_HISTORICAL_SERIES"], formulaVersion: rootMetrics.formulaVersion, assetConservationDelta: "0", dataAsOf: snapshot.as_of }), "branch-simulation-v4", now);
    for (const holding of holdings) db.prepare("INSERT INTO simulation_asset_snapshot_items (id, snapshot_id, instrument_id, quantity_decimal, cost_decimal, price_decimal, market_value_decimal, weight_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(createId("sim_item"), simSnapshotId, holding.instrument_id, holding.quantity_decimal, holding.cost_decimal ?? "0", holding.price_decimal, holding.market_value_decimal, holding.weight_bps, now);
    db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, to_branch_id, user_id, created_at) VALUES (?, ?, 'root_created', ?, ?, ?)").run(createId("branch_event"), workspaceId, branchId, userId, now);
  });
  publish();
  db.close();
  persistSseEvent({ analysisId, type: "branch.created", payload: { workspaceId, branchId, simulationId: simSnapshotId } });
  return { workspaceId, branchId, analysisId, version: 1, portfolioSnapshotId, portfolioSource: resolvedSnapshot.source };
}

export function getWorkspace(userId: string, workspaceId: string) {
  const db = getDatabase();
  const workspace = db.prepare("SELECT * FROM simulation_workspaces WHERE id = ? AND user_id = ?").get(workspaceId, userId) as Row | undefined;
  if (!workspace) { db.close(); return null; }
  const branches = db.prepare("SELECT * FROM simulation_branches WHERE workspace_id = ? ORDER BY depth, created_at, id").all(workspaceId) as Row[];
  const events = db.prepare("SELECT * FROM simulation_branch_events WHERE workspace_id = ? ORDER BY created_at, id").all(workspaceId) as Row[];
  const portfolioSnapshot = db.prepare("SELECT source_statuses_json FROM portfolio_snapshots WHERE id = ? AND user_id = ?").get(workspace.portfolio_snapshot_id, userId) as Row | undefined;
  const portfolioSource = portfolioSourceFromRow(portfolioSnapshot);
  db.close();
  return { id: workspace.id, name: workspace.label, objectiveText: workspace.objective_text, status: String(workspace.status).toUpperCase(), portfolioSnapshotId: workspace.portfolio_snapshot_id, portfolioSource, rootBranchId: workspace.root_branch_id ?? branches[0]?.id ?? null, activeBranchId: workspace.active_branch_id, branches: branches.map((branch) => ({ id: branch.id, parentBranchId: branch.parent_branch_id, label: branch.label, depth: branch.depth, status: branch.status })), events, version: workspace.row_version };
}

function resolvePortfolioSnapshot(userId: string, requestedId?: string): { id: string; source: SimulationPortfolioSource } {
  const db = getDatabase();
  const row = requestedId ? db.prepare("SELECT * FROM portfolio_snapshots WHERE id = ? AND user_id = ?").get(requestedId, userId) as Row | undefined : undefined;
  const activePortfolio = requestedId ? undefined : db.prepare(`
    SELECT portfolio_id AS portfolioId
    FROM holdings
    WHERE user_id = ? AND status = 'active'
    GROUP BY portfolio_id
    ORDER BY MAX(COALESCE(updated_at, created_at)) DESC, portfolio_id
    LIMIT 1
  `).get(userId) as { portfolioId?: string } | undefined;
  const activeSnapshot = activePortfolio?.portfolioId
    ? db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id = ? AND portfolio_id = ? ORDER BY created_at DESC LIMIT 1").get(userId, activePortfolio.portfolioId) as Row | undefined
    : undefined;
  db.close();

  if (requestedId && !row) throw new Error("Snapshot not found");
  if (row) return { id: String(row.id), source: portfolioSourceFromRow(row) };
  if (activeSnapshot) return { id: String(activeSnapshot.id), source: "USER_PORTFOLIO" };
  if (activePortfolio?.portfolioId) {
    const synced = syncPortfolioFromHoldings(userId, activePortfolio.portfolioId);
    return { id: synced.snapshotId, source: "USER_PORTFOLIO" };
  }
  return createStarterPortfolioSnapshot(userId);
}

function createStarterPortfolioSnapshot(userId: string): { id: string; source: SimulationPortfolioSource } {
  const db = getDatabase();
  const portfolioId = `simulation-starter-${userId}`;
  const existing = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id = ? AND portfolio_id = ? ORDER BY created_at DESC LIMIT 1").get(userId, portfolioId) as Row | undefined;
  if (existing) {
    db.close();
    return { id: String(existing.id), source: "STARTER_PORTFOLIO" };
  }

  const now = isoNow();
  const snapshotId = createId("portfolio_snapshot");
  const starterHoldings = [
    { instrumentId: "AAPL", symbol: "AAPL", name: "Apple", market: "NASDAQ", assetType: "stock", sector: "Technology", quantity: "8", price: "190" },
    { instrumentId: "MSFT", symbol: "MSFT", name: "Microsoft", market: "NASDAQ", assetType: "stock", sector: "Technology", quantity: "4", price: "420" },
    { instrumentId: "SPY", symbol: "SPY", name: "SPDR S&P 500 ETF", market: "NYSE", assetType: "fund", sector: "Broad Market", quantity: "10", price: "520" },
    { instrumentId: "GLD", symbol: "GLD", name: "SPDR Gold Shares", market: "NYSE", assetType: "fund", sector: "Commodities", quantity: "8", price: "215" },
  ];
  const totalMarketValue = starterHoldings.reduce((total, holding) => total + Number(holding.quantity) * Number(holding.price), 0);
  const publish = db.transaction(() => {
    for (const holding of starterHoldings) {
      db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, name, market, asset_type, sector, tradable) VALUES (?, ?, ?, ?, ?, ?, 1)")
        .run(holding.instrumentId, holding.symbol, holding.name, holding.market, holding.assetType, holding.sector);
    }
    db.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at) VALUES (?,?,?,?,?,'partial',?,?,?)")
      .run(snapshotId, userId, portfolioId, "20000", String(totalMarketValue), json([{ source: "STARTER_PORTFOLIO", status: "FALLBACK" }]), now, now);
    const weights = starterHoldings.map((holding) => Math.round((Number(holding.quantity) * Number(holding.price) / totalMarketValue) * 10_000));
    for (const [index, holding] of starterHoldings.entries()) {
      const marketValue = Number(holding.quantity) * Number(holding.price);
      db.prepare("INSERT INTO holding_snapshots (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(createId("holding_snapshot"), snapshotId, holding.instrumentId, holding.quantity, holding.price, holding.price, String(marketValue), "0", weights[index], now);
    }
  });
  publish();
  db.close();
  return { id: snapshotId, source: "STARTER_PORTFOLIO" };
}

function portfolioSourceFromRow(row: Row | undefined): SimulationPortfolioSource {
  const statuses = parseJson<Array<{ source?: string }>>(String(row?.source_statuses_json ?? "[]"), []);
  return statuses.some((status) => status.source === "STARTER_PORTFOLIO") ? "STARTER_PORTFOLIO" : "USER_PORTFOLIO";
}

export function generateOptions(userId: string, workspaceId: string, objective: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  if (workspace.status === "ARCHIVED") throw new Error("WORKSPACE_ARCHIVED");
  const branchId = workspace.activeBranchId;
  const db = getDatabase();
  const now = isoNow();
  const batchId = createId("option_batch");
  const analysisId = createId("analysis");
  const running = db.prepare("SELECT id FROM simulation_option_batches WHERE workspace_id=? AND status IN ('queued','running') LIMIT 1").get(workspaceId) as { id?: string } | undefined;
  if (running || activeOptionRuns.has(workspaceId)) { db.close(); throw new Error("OPTIONS_ALREADY_RUNNING"); }
  db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id, user_id, type, status, objective, agent_type, created_at) VALUES (?, ?, 'branch_option_generation', 'queued', ?, 'branch_scenario_chief_advisor', ?)").run(analysisId, userId, objective.slice(0, 500), now);
    db.prepare("INSERT INTO simulation_option_batches (id, workspace_id, branch_id, agent_run_id, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)").run(batchId, workspaceId, branchId, analysisId, now);
  })();
  db.close();
  persistSseEvent({ analysisId, type: "run.started", payload: { workspaceId, branchId, batchId, status: "QUEUED" } });
  const controller = new AbortController();
  const promise = runOptionGeneration({ userId, workspaceId, branchId: String(branchId), objective, batchId, analysisId, controller })
    .finally(() => activeOptionRuns.delete(workspaceId));
  activeOptionRuns.set(workspaceId, { controller, promise });
  return { batchId, analysisId, status: "queued" as const };
}

async function runOptionGeneration(input: {
  userId: string;
  workspaceId: string;
  branchId: string;
  objective: string;
  batchId: string;
  analysisId: string;
  controller: AbortController;
}): Promise<void> {
  const startedAt = isoNow();
  const startedDb = getDatabase();
  startedDb.prepare("UPDATE agent_runs SET status='running', started_at=?, input_summary=? WHERE id=? AND user_id=?").run(startedAt, input.objective.slice(0, 500), input.analysisId, input.userId);
  startedDb.prepare("UPDATE simulation_option_batches SET status='running' WHERE id=? AND workspace_id=?").run(input.batchId, input.workspaceId);
  startedDb.close();
  persistSseEvent({ analysisId: input.analysisId, type: "agent.started", payload: { workspaceId: input.workspaceId, branchId: input.branchId, batchId: input.batchId } });
  try {
    const generated = await withTimeout(
      generateCandidates(input.objective, input.workspaceId, input.branchId, input.userId, {
        onAgentStarted: (role, label) => persistSseEvent({ analysisId: input.analysisId, type: "agent.delegated", payload: { agent: role, label } }),
        onAgentCompleted: (role, summary) => persistSseEvent({ analysisId: input.analysisId, type: "agent.completed", payload: { agent: role, conclusion: summary } }),
      }),
      OPTION_GENERATION_TIMEOUT_MS,
      input.controller,
    );
    const optionIds: string[] = [];
    const completedAt = isoNow();
    const db = getDatabase();
    db.transaction(() => {
      db.prepare("UPDATE simulation_option_batches SET status='succeeded', price_manifest_json=?, price_manifest_sha256=? WHERE id=? AND workspace_id=?").run(json(generated.priceManifest), generated.priceManifest.sha256, input.batchId, input.workspaceId);
      for (const candidate of generated.candidates) {
        const optionId = createId("option");
        optionIds.push(optionId);
        db.prepare("INSERT INTO simulation_options (id, batch_id, workspace_id, sequence_no, label, description_text, trades_json, analysis_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(optionId, input.batchId, input.workspaceId, candidate.sequenceNo, candidate.label, candidate.description, json(candidate.trades), json({ ...candidate.analysis, targetAllocations: candidate.targetAllocations, tradeIntent: candidate.tradeIntent, provider: generated.provider, delegatedAgents: generated.delegatedAgents }), completedAt);
      }
      db.prepare("UPDATE agent_runs SET status='completed', completed_at=?, model_provider=?, model_name=?, output_summary=?, result_json=? WHERE id=? AND user_id=?").run(completedAt, generated.provider === "CHIEF_ADVISOR" ? "deepseek" : "deterministic", process.env.DEEPSEEK_MODEL ?? null, `${generated.candidates.length} options generated`, json({ batchId: input.batchId, provider: generated.provider, optionCount: generated.candidates.length, priceManifestSha256: generated.priceManifest.sha256 }), input.analysisId, input.userId);
    })();
    db.close();
    persistSseEvent({ analysisId: input.analysisId, type: "branch.options.created", payload: { workspaceId: input.workspaceId, branchId: input.branchId, batchId: input.batchId, optionIds, provider: generated.provider } });
    persistSseEvent({ analysisId: input.analysisId, type: "run.completed", payload: { workspaceId: input.workspaceId, batchId: input.batchId, status: "SUCCEEDED", provider: generated.provider, optionCount: generated.candidates.length } });
  } catch (error) {
    const message = safeMessage(error);
    const failedAt = isoNow();
    const db = getDatabase();
    db.transaction(() => {
      db.prepare("UPDATE simulation_option_batches SET status='failed' WHERE id=? AND workspace_id=?").run(input.batchId, input.workspaceId);
      db.prepare("UPDATE agent_runs SET status='failed', completed_at=?, failure_code=?, failure_message=? WHERE id=? AND user_id=?").run(failedAt, message === "SIMULATION_TIMEOUT" ? "SIMULATION_TIMEOUT" : "BRANCH_OPTION_GENERATION_FAILED", message, input.analysisId, input.userId);
    })();
    db.close();
    persistSseEvent({ analysisId: input.analysisId, type: "branch.options.failed", payload: { workspaceId: input.workspaceId, batchId: input.batchId, code: "BRANCH_OPTION_GENERATION_FAILED" } });
    persistSseEvent({ analysisId: input.analysisId, type: "run.failed", payload: { workspaceId: input.workspaceId, batchId: input.batchId, status: "FAILED", code: "BRANCH_OPTION_GENERATION_FAILED" } });
  }
}

export function listOptions(userId: string, workspaceId: string, batchId?: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) return null;
  const db = getDatabase();
  const batch = (batchId
    ? db.prepare("SELECT b.*,r.status AS run_status,r.model_provider FROM simulation_option_batches b LEFT JOIN agent_runs r ON r.id=b.agent_run_id WHERE b.id = ? AND b.workspace_id = ?").get(batchId, workspaceId)
    : db.prepare("SELECT b.*,r.status AS run_status,r.model_provider FROM simulation_option_batches b LEFT JOIN agent_runs r ON r.id=b.agent_run_id WHERE b.workspace_id = ? AND b.branch_id = ? ORDER BY b.created_at DESC LIMIT 1").get(workspaceId, workspace.activeBranchId)) as Row | undefined;
  if (!batch) { db.close(); return { batch: null, items: [] }; }
  const items = db.prepare("SELECT * FROM simulation_options WHERE batch_id = ? ORDER BY sequence_no").all(batch.id) as Row[];
  db.close();
  return { batch, items: items.map((item) => ({ id: item.id, label: item.label, summary: item.description_text, trades: parseJson(item.trades_json as string, []), analysis: parseJson(item.analysis_json as string, {}) })), analysisId: batch.agent_run_id, provider: normalizeProvider(batch.model_provider) };
}

export function executeOption(userId: string, workspaceId: string, input: { parentBranchId: string; optionId: string; name: string }) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  if (workspace.status === "ARCHIVED") throw new Error("WORKSPACE_ARCHIVED");
  const db = getDatabase();
  const option = db.prepare("SELECT * FROM simulation_options WHERE id = ? AND workspace_id = ?").get(input.optionId, workspaceId) as Row | undefined;
  const parent = db.prepare("SELECT * FROM simulation_asset_snapshots WHERE branch_id = ? AND workspace_id = ?").get(input.parentBranchId, workspaceId) as Row | undefined;
  const batch = option ? db.prepare("SELECT * FROM simulation_option_batches WHERE id = ? AND workspace_id = ?").get(option.batch_id, workspaceId) as Row | undefined : undefined;
  if (!option || !parent || !batch) { db.close(); throw new Error("Branch or option not found"); }
  if (String(batch.branch_id) !== input.parentBranchId) { db.close(); throw new Error("OPTION_BRANCH_MISMATCH"); }
  if (option.executed_branch_id) { db.close(); throw new Error("OPTION_ALREADY_EXECUTED"); }
  const now = isoNow();
  const branchId = createId("branch");
  const assetSnapshotId = createId("sim_snapshot");
  const analysisId = createId("analysis");
  const trades = parseJson<Array<{ instrumentId: string; action: string; quantity: string; price?: string }>>(option.trades_json as string, []);
  const sourceItems = db.prepare(`SELECT h.*,i.asset_type,i.sector FROM simulation_asset_snapshot_items h
    JOIN instruments i ON i.id=h.instrument_id WHERE h.snapshot_id=?`).all(parent.id) as Row[];
  let simulation: ReturnType<typeof executeSimulation>;
  try {
    simulation = executeSimulation(
      String(parent.cash_decimal),
      sourceItems.map((item) => ({ instrumentId: String(item.instrument_id), quantity: String(item.quantity_decimal), cost: nullableCost(item.cost_decimal), marketValue: String(item.market_value_decimal), assetType: String(item.asset_type), sector: item.sector == null ? null : String(item.sector) })),
      { sequenceNo: Number(option.sequence_no), label: String(option.label), description: String(option.description_text), trades: trades as SimulationCandidate["trades"], targetAllocations: [], tradeIntent: "persisted option execution", analysis: parseJson(option.analysis_json as string, {}) as SimulationCandidate["analysis"] },
      assertManifest(parseJson<PriceManifest>(batch.price_manifest_json as string, {} as PriceManifest), String(batch.price_manifest_sha256)),
    );
  } catch (error) {
    db.close();
    throw error;
  }
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,?,'completed',?,?)").run(analysisId, userId, "branch_execution", now, now);
    db.prepare("INSERT INTO simulation_branches (id, workspace_id, parent_branch_id, parent_option_id, label, depth, status, created_at, updated_at) SELECT ?, workspace_id, ?, ?, ?, depth + 1, 'active', ?, ? FROM simulation_branches WHERE id = ?").run(branchId, input.parentBranchId, option.id, input.name, now, now, input.parentBranchId);
    db.prepare("INSERT INTO simulation_asset_snapshots (id, workspace_id, branch_id, portfolio_snapshot_id, base_snapshot_id, cash_decimal, total_market_value_decimal, metrics_json, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(assetSnapshotId, workspaceId, branchId, parent.portfolio_snapshot_id, parent.id, simulation.newCashDecimal, simulation.newTotalMarketValue, json({ ...simulation.metrics, totalAssets: simulation.newTotalAssets, costBasis: simulation.costBasis, unrealizedPnl: simulation.unrealizedPnl, dataAsOf: assertManifest(parseJson<PriceManifest>(batch.price_manifest_json as string, {} as PriceManifest), String(batch.price_manifest_sha256)).capturedAt }), "branch-simulation-v4", now);
    for (const item of simulation.holdings) db.prepare("INSERT INTO simulation_asset_snapshot_items (id, snapshot_id, instrument_id, quantity_decimal, cost_decimal, price_decimal, market_value_decimal, weight_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(createId("sim_item"), assetSnapshotId, item.instrumentId, item.quantity, item.cost ?? "0", item.price, item.marketValue, item.weightBps, now);
    db.prepare("UPDATE simulation_options SET executed_branch_id = ? WHERE id = ?").run(branchId, option.id);
    db.prepare("UPDATE simulation_workspaces SET active_branch_id = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ?").run(branchId, now, workspaceId, userId);
    db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, option_id, user_id, created_at) VALUES (?, ?, 'option_executed', ?, ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, input.parentBranchId, branchId, option.id, userId, now);
  });
  publish();
  db.close();
  persistSseEvent({ analysisId, type: "branch.created", payload: { workspaceId, branchId, simulationId: assetSnapshotId } });
  return { branchId, snapshotId: assetSnapshotId, activeBranchId: branchId, analysisId, metrics: simulation.metrics, tradingFees: simulation.tradingFees };
}

export function switchBranch(userId: string, workspaceId: string, branchId: string, expectedVersion?: number) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace || !workspace.branches.some((branch) => branch.id === branchId)) return null;
  if (expectedVersion !== undefined && workspace.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
  const db = getDatabase();
  const now = isoNow();
  const update = db.transaction(() => {
    const result = db.prepare("UPDATE simulation_workspaces SET active_branch_id = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND row_version = ?").run(branchId, now, workspaceId, userId, expectedVersion ?? workspace.version);
    if (!result.changes) throw new Error("VERSION_CONFLICT");
    db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, user_id, created_at) VALUES (?, ?, 'branch_switched', ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, workspace.activeBranchId, branchId, userId, now);
  });
  try {
    update();
  } catch (error) {
    db.close();
    throw error;
  }
  const updated = db.prepare("SELECT row_version FROM simulation_workspaces WHERE id = ?").get(workspaceId) as { row_version: number };
  db.close();
  return { activeBranchId: branchId, version: updated.row_version };
}

export function undoBranch(userId: string, workspaceId: string, expectedVersion?: number) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) return null;
  const active = workspace.branches.find((branch) => branch.id === workspace.activeBranchId);
  if (!active?.parentBranchId) throw new Error("ROOT_BRANCH_CANNOT_UNDO");
  const db = getDatabase();
  const now = isoNow();
  let version: number;
  try {
    const update = db.transaction(() => {
      const result = db.prepare("UPDATE simulation_workspaces SET active_branch_id = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND row_version = ?").run(active.parentBranchId, now, workspaceId, userId, expectedVersion ?? workspace.version);
      if (!result.changes) throw new Error("VERSION_CONFLICT");
      db.prepare("INSERT INTO simulation_branch_events (id, workspace_id, event_type, from_branch_id, to_branch_id, user_id, created_at) VALUES (?, ?, 'undo', ?, ?, ?, ?)").run(createId("branch_event"), workspaceId, active.id, active.parentBranchId, userId, now);
    });
    update();
    version = Number((db.prepare("SELECT row_version FROM simulation_workspaces WHERE id=?").get(workspaceId) as { row_version: number }).row_version);
  } catch (error) {
    db.close();
    throw error;
  }
  db.close();
  return { activeBranchId: active.parentBranchId, version };
}

export function getBranchSnapshot(userId: string, workspaceId: string, branchId: string) {
  const workspace = getWorkspace(userId, workspaceId);
  if (!workspace) return null;
  const db = getDatabase();
  const snapshot = db.prepare("SELECT * FROM simulation_asset_snapshots WHERE workspace_id = ? AND branch_id = ?").get(workspaceId, branchId) as Row | undefined;
  if (!snapshot) { db.close(); return null; }
  const items = db.prepare("SELECT * FROM simulation_asset_snapshot_items WHERE snapshot_id = ?").all(snapshot.id) as Row[];
  const metrics = parseJson<Record<string, unknown>>(snapshot.metrics_json as string, {});
  db.close();
  const db2 = getDatabase();
  const manifest = db2.prepare("SELECT b.price_manifest_sha256 FROM simulation_options o JOIN simulation_option_batches b ON b.id = o.batch_id WHERE o.executed_branch_id = ?").get(branchId) as { price_manifest_sha256?: string } | undefined;
  db2.close();
  return {
    cash: snapshot.cash_decimal,
    totalValue: snapshot.total_market_value_decimal,
    totalAssets: metrics.totalAssets ?? String(Number(snapshot.cash_decimal) + Number(snapshot.total_market_value_decimal)),
    costBasis: metrics.costBasis ?? "0",
    unrealizedPnl: metrics.unrealizedPnl ?? "0",
    holdings: items.map((item) => ({ instrumentId: item.instrument_id, quantity: item.quantity_decimal, cost: nullableCost(item.cost_decimal), price: item.price_decimal, marketValue: item.market_value_decimal, weightBps: item.weight_bps })),
    metrics,
    priceManifestSha256: manifest?.price_manifest_sha256 ?? null,
    dataAsOf: String(metrics.dataAsOf ?? snapshot.created_at),
    engineVersion: snapshot.model_version,
  };
}

function assertManifest(manifest: PriceManifest, persistedSha256: string): PriceManifest {
  if (!manifest || typeof manifest !== "object" || manifest.sha256 !== persistedSha256) throw new Error("PRICE_MANIFEST_HASH_MISMATCH");
  return manifest;
}

function nullableCost(value: unknown): string | null {
  const text = value == null ? "" : String(value);
  return text && text !== "0" ? text : null;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("SIMULATION_TIMEOUT"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "BRANCH_OPTION_GENERATION_FAILED";
}

function normalizeProvider(value: unknown): "CHIEF_ADVISOR" | "DETERMINISTIC_FALLBACK" | null {
  if (String(value).toLowerCase() === "deepseek") return "CHIEF_ADVISOR";
  if (String(value).toLowerCase() === "deterministic") return "DETERMINISTIC_FALLBACK";
  return null;
}
